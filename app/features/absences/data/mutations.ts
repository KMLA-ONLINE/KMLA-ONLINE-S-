import { getSupabase } from "~/shared/supabase/client";

export async function setMyAbsence(reason: string): Promise<void> {
  const { error } = await getSupabase().rpc("set_my_absence", {
    p_reason: reason,
  });

  if (error) throw error;
}

export async function deleteMyAbsence(): Promise<void> {
  const { error } = await getSupabase().rpc("delete_my_absence");

  if (error) throw error;
}
