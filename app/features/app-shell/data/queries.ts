import type {
  ShellData,
  ShellLoadData,
} from "~/features/app-shell/model/types";
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

export async function loadShellData(): Promise<ShellLoadData | null> {
  const supabase = getSupabase();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) throw sessionError;
  if (!session) return null;

  const { data: profiles, error: profileError } =
    await supabase.rpc("get_my_profile");
  if (profileError) throw profileError;

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
  if (notificationCount.error) throw notificationCount.error;

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
