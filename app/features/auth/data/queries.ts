import { getSupabase } from "~/shared/supabase/client";
import type { AuthState } from "~/features/auth/model/types";

export async function loadAuthState(): Promise<AuthState | null> {
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

  return {
    email: session.user.email ?? "",
    profile: profiles[0] ?? null,
  };
}
