import { getSupabase } from "~/shared/supabase/client";

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();

  if (error) throw error;
}
