import type { AcceptedProfile } from "~/features/profiles/model/types";
import { getSupabase } from "~/shared/supabase/client";

const PROFILE_COLUMNS =
  "pub_id, name, type, role, cohort, academic_track, avatar_path, description" as const;

export async function loadAcceptedProfile(
  pubId: string,
): Promise<AcceptedProfile | null> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("pub_id", pubId.toLowerCase())
    .eq("status", "accepted")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return data;
}
