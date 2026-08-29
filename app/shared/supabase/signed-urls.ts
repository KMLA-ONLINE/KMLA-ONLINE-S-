/**
 * Storage signed URL을 발급하고 재사용하는 단일 지점이다.
 *
 * 이전에는 `post-attachments`, `profile-media`, `group-media`가 각자 같은 60줄짜리
 * Map 캐시를 들고 있었다. 그 캐시들은 만료 비교와 in-flight 합치기를 손으로 구현한
 * 것이었는데, 둘 다 QueryClient가 `staleTime`과 키 단위 중복 제거로 이미 하는 일이다.
 * 여기서는 쿼리 캐시에 얹고, 손으로 남는 건 "한 tick에 모인 경로를 한 번의 요청으로
 * 묶는" 배치뿐이다.
 *
 * 캐시를 QueryClient로 옮기면서 따라오는 것: 사용자가 바뀔 때 `QueryProvider`가 부르는
 * `queryClient.clear()`가 signed URL까지 함께 버린다. 이전에는 모듈 Map이 그대로 남아
 * 로그아웃 뒤에도 최대 55분간 유효한 URL이 메모리에 살아 있었다.
 */
import { queryOptions } from "@tanstack/react-query";

import {
  getQueryClient,
  resetQueryClientForTests,
} from "~/shared/lib/query-client";
import { getSupabase } from "~/shared/supabase/client";

export type SignedUrlBucket =
  "post-attachments" | "profile-media" | "group-media";

/** Storage에 요청하는 URL 유효 기간. */
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * 만료 5분 전에 버린다. `gcTime`을 같은 값으로 두는 이유는, 기본 `gcTime`(10분)이면
 * 화면을 잠깐 벗어난 사이 아직 45분 남은 URL을 버리고 다시 서명하기 때문이다.
 */
const SIGNED_URL_STALE_TIME = 55 * 60 * 1000;

interface Waiter {
  resolve: (url: string) => void;
  reject: (reason: unknown) => void;
}

interface PendingBatch {
  paths: string[];
  waiters: Map<string, Waiter[]>;
}

const batches = new Map<SignedUrlBucket, PendingBatch>();

/**
 * 같은 tick에 들어온 경로를 모아 `createSignedUrls` 한 번으로 처리한다.
 *
 * flush를 마이크로태스크가 아니라 매크로태스크로 미루는 게 중요하다. 호출부는
 * `Promise.all(paths.map(...))`로 N개를 동시에 띄우지만, 그 사이의 `queryClient.query()`가
 * `queryFn`에 닿기까지 내부에서 몇 단계의 promise를 거친다. 마이크로태스크로 flush하면
 * 첫 경로만 담긴 배치가 먼저 나가고 나머지가 각각 따로 요청된다.
 */
function signPath(bucket: SignedUrlBucket, path: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let batch = batches.get(bucket);

    if (!batch) {
      batch = { paths: [], waiters: new Map() };
      batches.set(bucket, batch);
      setTimeout(() => void flushBatch(bucket), 0);
    }

    const waiters = batch.waiters.get(path);

    if (waiters) {
      waiters.push({ resolve, reject });
      return;
    }

    batch.paths.push(path);
    batch.waiters.set(path, [{ resolve, reject }]);
  });
}

async function flushBatch(bucket: SignedUrlBucket): Promise<void> {
  const batch = batches.get(bucket);

  if (!batch) return;

  // 다음 배치가 이 요청을 기다리지 않도록 먼저 떼어낸다.
  batches.delete(bucket);

  try {
    const { data, error } = await getSupabase()
      .storage.from(bucket)
      .createSignedUrls(batch.paths, SIGNED_URL_TTL_SECONDS);

    if (error) throw error;

    const signed = new Map(
      (data ?? []).flatMap((item) =>
        item.path && item.signedUrl
          ? ([[item.path, item.signedUrl]] as const)
          : [],
      ),
    );

    for (const [path, waiters] of batch.waiters) {
      const url = signed.get(path);

      for (const waiter of waiters) {
        if (url) waiter.resolve(url);
        else waiter.reject(new Error(`No signed URL for ${bucket}/${path}.`));
      }
    }
  } catch (cause) {
    for (const waiters of batch.waiters.values()) {
      for (const waiter of waiters) waiter.reject(cause);
    }
  }
}

/**
 * 키에 사용자 ID를 담는다. `clear()`가 이미 사용자 전환을 처리하지만, 그건 auth 이벤트가
 * 도착한 뒤의 일이다. 키로 갈라 두면 그 사이에도 다른 사용자의 URL을 집을 수 없다.
 */
export function signedUrlQuery(
  bucket: SignedUrlBucket,
  userId: string,
  path: string,
) {
  return queryOptions({
    queryKey: ["signed-url", bucket, userId, path] as const,
    queryFn: () => signPath(bucket, path),
    staleTime: SIGNED_URL_STALE_TIME,
    gcTime: SIGNED_URL_STALE_TIME,
    // 실패는 캐시에 남기지 않고 다음 호출에서 다시 시도한다. 기본 retry(1)는 만료된
    // 세션처럼 재시도가 의미 없는 실패에 왕복만 한 번 더 쓴다.
    retry: false,
  });
}

/**
 * 서명에 실패한 경로는 Map에서 빠진다. 호출부는 이미 `urls.get(path) ?? null`로 읽고
 * 있어서, 이미지 하나를 못 얻었다고 화면 전체가 죽지 않는다.
 */
export async function createSignedUrls(
  bucket: SignedUrlBucket,
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const uniquePaths = [
    ...new Set(paths.filter((path): path is string => Boolean(path))),
  ];
  const urls = new Map<string, string>();

  if (uniquePaths.length === 0) return urls;

  const { data } = await getSupabase().auth.getSession();
  const userId = data.session?.user.id;
  const queryClient = getQueryClient();

  const results = await Promise.allSettled(
    uniquePaths.map((path) =>
      // 세션이 없으면 캐시에 넣지 않는다. 어차피 Storage가 거절하고, 익명 상태에서 받은
      // URL을 로그인 뒤에 재사용할 이유도 없다.
      userId
        ? queryClient.query(signedUrlQuery(bucket, userId, path))
        : signPath(bucket, path),
    ),
  );

  uniquePaths.forEach((path, index) => {
    const result = results[index];

    if (result?.status === "fulfilled") urls.set(path, result.value);
  });

  return urls;
}

export function resetSignedUrlCacheForTests(): void {
  batches.clear();
  resetQueryClientForTests();
}
