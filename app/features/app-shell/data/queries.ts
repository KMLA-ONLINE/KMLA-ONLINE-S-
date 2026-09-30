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
 * 셸 아바타도 공용 서명 캐시를 지난다. `createSignedUrl`을 직접 부르면 재검증마다 토큰이 바뀌어 `<img>`가 브라우저 캐시를 놓친다.
 */
async function resolveProfileAvatar(
  path: string | null,
): Promise<string | null> {
  if (!path) return null;

  const urls = await createProfileMediaUrls([path]);
  return urls.get(path) ?? null;
}

/**
 * 게이트가 쓰는 셸 데이터를 읽는다. `null`은 "인증되지 않음"이며 게이트가 `/login`으로 보낸다. 서버가 세션을 거절한 경우도 접는다 —
 * 던지면 루트 ErrorBoundary가 잡아 앱이 깨진 것처럼 보인다.
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
