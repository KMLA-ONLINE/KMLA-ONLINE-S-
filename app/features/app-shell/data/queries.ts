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
import { getSupabase } from "~/shared/supabase/client";

async function resolveProfileAvatar(
  path: string | null,
): Promise<string | null> {
  if (!path || /^https?:\/\//i.test(path)) return path;

  const { data, error } = await getSupabase()
    .storage.from("profile-media")
    .createSignedUrl(path, 3600);

  if (error) return null;
  return data.signedUrl;
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
    return { email: session.user.email ?? "", profile: null, badges: {} };
  }

  const [avatarUrl, notificationCount] = await Promise.all([
    resolveProfileAvatar(profile.avatar_path),
    profile.status === "accepted"
      ? supabase.rpc("get_my_recent_unread_notification_count")
      : Promise.resolve({ data: 0, error: null }),
  ]);
  if (notificationCount.error) {
    await clearSessionOrThrow(notificationCount.error);
    return null;
  }

  const shellProfile: ShellData["profile"] = {
    id: profile.id,
    pub_id: profile.pub_id,
    name: profile.name,
    role: profile.role,
    type: profile.type,
    status: profile.status,
    avatar_url: avatarUrl,
  };

  return {
    email: session.user.email ?? "",
    profile: shellProfile,
    badges: { "/noti": notificationCount.data ?? 0 },
  };
}
