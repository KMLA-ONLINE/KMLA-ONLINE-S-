import { getSupabase } from "~/shared/supabase/client";

export async function fetchMinClientVersion(): Promise<number> {
  const { data, error } = await getSupabase().rpc("min_client_version");
  if (error) throw error;
  return data;
}
