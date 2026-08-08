import type {
  ShellData,
  ShellLoadData,
} from "~/features/app-shell/model/types";
import { getSupabase } from "~/shared/supabase/client";

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

  const shellProfile: ShellData["profile"] = {
    id: profile.id,
    pub_id: profile.pub_id,
    name: profile.name,
    role: profile.role,
    type: profile.type,
    status: profile.status,
    avatar_url: profile.avatar_path,
  };

  return {
    email: session.user.email ?? "",
    profile: shellProfile,
    // Messaging and notification migrations have not landed yet.
    badges: {},
  };
}
