import { queryOptions } from "@tanstack/react-query";

import type {
  ShellData,
  ShellLoadData,
} from "~/features/app-shell/model/types";
// 배럴(`~/features/auth`)은 React 컴포넌트와 notifications feature까지 끌고 온다. 세션
// 해석만 필요하므로 그 모듈만 직접 가져온다.
import {
  clearSessionOrThrow,
  readLiveSession,
} from "~/features/auth/data/queries";
// 배럴(`~/features/profiles`)은 화면 컴포넌트를 전부 끌고 온다. 서명 헬퍼만 필요하다.
import { createProfileMediaUrls } from "~/features/profiles/data/media";
import { getQueryClient } from "~/shared/lib/query-client";
import { getSupabase } from "~/shared/supabase/client";

/**
 * 셸 아바타 URL. 게이트를 막지 않도록 셸 데이터에서 빼고 `AppShellProvider`가 나중에 채운다.
 * 공용 서명 캐시를 지난다. `createSignedUrl`을 직접 부르면 재검증마다 토큰이 바뀌어 `<img>`가 브라우저 캐시를 놓친다.
 */
export function shellAvatarQuery(path: string | null) {
  return queryOptions({
    queryKey: ["app-shell", "avatar", path] as const,
    queryFn: async () => {
      if (!path) return null;
      const urls = await createProfileMediaUrls([path]);
      return urls.get(path) ?? null;
    },
    enabled: Boolean(path),
    // 서명 캐시(55분)보다 짧게 둬서, 다시 읽을 때는 아직 유효한 URL을 캐시에서 받는다.
    staleTime: 30 * 60 * 1000,
  });
}

export const appShellKeys = {
  profile: () => ["app-shell", "profile"] as const,
};

/**
 * 셸 프로필. 게이트 loader가 첫 값을 넣고, 그 뒤로는 `refreshShellProfile()`이 부를 때만 다시 읽는다.
 * 게이트를 mutation마다 재검증하지 않으므로, 셸 프로필이 바뀌는 곳이 직접 이 쿼리를 갱신한다.
 */
export function shellProfileQuery() {
  return queryOptions({
    queryKey: appShellKeys.profile(),
    // 정지 여부는 게이트만 본다. 셸 값(`ShellData`)과 모양을 맞춘다.
    queryFn: async () => {
      const shell = await fetchShellData();
      return shell && { email: shell.email, profile: shell.profile };
    },
    staleTime: Infinity,
  });
}

/** 게이트가 이미 채워 둔 셸 프로필 ID. 게이트와 병렬로 도는 로더가 기다리지 않고 읽는다. */
export function readShellProfileId(): number | null {
  return (
    getQueryClient().getQueryData(shellProfileQuery().queryKey)?.profile?.id ??
    null
  );
}

/** 셸에 떠 있는 사용자인지. 다른 사람의 프로필을 바꾼 action이 셸을 다시 읽지 않게 거른다. */
export function isShellProfile(profileId: number): boolean {
  return (
    getQueryClient().getQueryData(shellProfileQuery().queryKey)?.profile?.id ===
    profileId
  );
}

/** 이름·아바타·역할처럼 셸 프로필 필드를 바꾼 action이 부른다. 다시 읽을 때까지 기다린다. */
export function refreshShellProfile(): Promise<void> {
  return getQueryClient().invalidateQueries({
    queryKey: appShellKeys.profile(),
  });
}

/**
 * 세션과 프로필을 읽는다. 서버가 세션을 거절한 경우도 `null`로 접는다 — 던지면 루트
 * ErrorBoundary가 잡아 앱이 깨진 것처럼 보인다.
 */
async function fetchShellData(): Promise<ShellLoadData | null> {
  const supabase = getSupabase();
  const session = await readLiveSession();
  if (!session) return null;

  const [
    { data: profiles, error: profileError },
    { data: suspensions, error: suspensionError },
  ] = await Promise.all([
    supabase.rpc("get_my_profile"),
    supabase.rpc("get_my_suspension"),
  ]);
  if (profileError) {
    await clearSessionOrThrow(profileError);
    return null;
  }
  if (suspensionError) {
    await clearSessionOrThrow(suspensionError);
    return null;
  }

  const email = session.user.email ?? "";
  const suspended = suspensions.length > 0;
  const profile = profiles[0];
  if (!profile) {
    return { email, profile: null, suspended };
  }

  const shellProfile: ShellData["profile"] = {
    id: profile.id,
    pub_id: profile.pub_id,
    name: profile.name,
    role: profile.role,
    type: profile.type,
    status: profile.status,
    avatar_path: profile.avatar_path,
  };

  return { email, profile: shellProfile, suspended };
}

/** 미리 띄운 셸 데이터가 게이트에서 쓰일 수 있는 시간. 그 뒤라면 낡았을 수 있어 새로 읽는다. */
const PREFETCH_TTL_MS = 10_000;

let prefetched: {
  promise: Promise<ShellLoadData | null>;
  startedAt: number;
} | null = null;

/**
 * 게이트보다 앞선 화면(알림 착지점)이 셸 데이터를 미리 띄운다. 다음 `loadShellData()` 한 번이 이
 * 결과를 넘겨받는다. 실패하면 그때 새로 읽어 복구하므로 여기서는 삼킨다.
 *
 * 띄운 화면이 게이트로 가지 않게 되면(로그인 이동, 목적지 확인 실패) `discardPrefetchedShellData()`로
 * 버린다. 남겨 두면 TTL 안에 다른 경로로 들어온 게이트가 그 사이 바뀌었을 수 있는 값을 받는다.
 */
export function prefetchShellData(): void {
  const promise = fetchShellData();
  promise.catch(() => undefined);
  prefetched = { promise, startedAt: Date.now() };
}

export function discardPrefetchedShellData(): void {
  prefetched = null;
}

/**
 * 게이트가 쓰는 셸 데이터를 읽는다. `null`은 "인증되지 않음"이며 게이트가 `/login`으로 보낸다.
 * 미리 띄운 값은 한 번만 쓴다. 그 요청이 실패했거나 "인증되지 않음"이었다면 일시적 오류였거나 그 사이
 * 로그인했을 수 있으므로 새로 읽는다. 미리 읽기 때문에 원래 열렸을 화면이 에러가 되면 안 된다.
 */
export async function loadShellData(): Promise<ShellLoadData | null> {
  const pending = prefetched;
  prefetched = null;
  if (pending && Date.now() - pending.startedAt < PREFETCH_TTL_MS) {
    const shell = await pending.promise.catch(() => null);
    if (shell) return shell;
  }
  return fetchShellData();
}
