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
 * 셸 아바타도 다른 이미지와 같은 서명 캐시를 지난다.
 *
 * 예전에는 여기서 `createSignedUrl`을 직접 불렀는데, 그러면 `["signed-url", ...]` 캐시를
 * 비켜 가서 게이트가 재검증될 때마다 새 토큰을 발급받았다. 토큰이 바뀌면 URL이 바뀌고,
 * URL이 바뀌면 `<img>`가 브라우저 캐시를 놓쳐 같은 아바타를 매번 다시 내려받았다.
 */
async function resolveProfileAvatar(
  path: string | null,
): Promise<string | null> {
  if (!path) return null;

  const urls = await createProfileMediaUrls([path]);
  return urls.get(path) ?? null;
}

/**
 * 게이트가 쓰는 셸 데이터를 읽는다.
 *
 * `null`은 "인증되지 않았다"는 뜻이며 게이트는 이걸 `/login`으로 옮긴다. 세션이 없는 경우뿐
 * 아니라 서버가 세션을 거절한 경우도 여기로 접는다. 거절을 그대로 던지면 로그인 화면으로
 * 가는 대신 루트 ErrorBoundary가 잡아 앱이 깨진 것처럼 보인다.
 */
export async function loadShellData(): Promise<ShellLoadData | null> {
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

  const avatarUrl = await resolveProfileAvatar(profile.avatar_path);

  const shellProfile: ShellData["profile"] = {
    id: profile.id,
    pub_id: profile.pub_id,
    name: profile.name,
    role: profile.role,
    type: profile.type,
    status: profile.status,
    avatar_url: avatarUrl,
  };

  return { email: session.user.email ?? "", profile: shellProfile };
}
