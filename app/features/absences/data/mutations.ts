import { getSupabase } from "~/shared/supabase/client";

export async function setMyAbsence(reason: string): Promise<void> {
  const { error } = await getSupabase().rpc("set_my_absence", {
    p_reason: reason,
  });

  if (error) throw error;
}
