import { getSupabase } from "~/shared/supabase/client";
import type { Json } from "~/shared/supabase/database.types";

export interface StoredTimetableRecord {
  activeSemester: string;
  semesters: unknown;
}

export async function loadTimetableRecord(
  profileId: number,
): Promise<StoredTimetableRecord | null> {
  const { data, error } = await getSupabase()
    .from("user_timetables")
    .select("active_semester, semesters")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    activeSemester: data.active_semester,
    semesters: data.semesters,
  };
}

export async function saveTimetableRecord(
  profileId: number,
  activeSemester: string,
  semesters: unknown,
): Promise<void> {
  const { error } = await getSupabase()
    .from("user_timetables")
    .upsert(
      {
        profile_id: profileId,
        active_semester: activeSemester,
        semesters: semesters as Json,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "profile_id",
      },
    );

  if (error) throw error;
}
