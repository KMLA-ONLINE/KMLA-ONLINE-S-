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

/**
 * 세션과 프로필을 읽는다. 서버가 세션을 거절한 경우도 `null`로 접는다 — 던지면 루트
 * ErrorBoundary가 잡아 앱이 깨진 것처럼 보인다.
 */
async function fetchShellData(): Promise<ShellLoadData | null> {
  const supabase = getSupabase();
  const session = await readLiveSession();
  if (!session) return null;

  const { data: profiles, error: profileError } =
    await supabase.rpc("get_my_profile");
  if (profileError) {
    await clearSessionOrThrow(profileError);
    return null;
  }

  const profile = profiles[0];
  if (!profile) {
    return { email: session.user.email ?? "", profile: null };
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

  return { email: session.user.email ?? "", profile: shellProfile };
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
 * 버린다. 남겨 두면 그 뒤 다른 이유로 돈 게이트, 예를 들어 프로필 수정 직후의 재검증이 수정 전 값을 받는다.
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
