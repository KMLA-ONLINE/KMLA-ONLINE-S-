import { getSupabase } from "~/shared/supabase/client";

export interface GongangScheduleEntry {
  scheduleDate: string;
  slot: string;
  location: string;
  reserved: boolean;
  detail: string | null;
}

export async function canManageGongang(profileId: number): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("profile_permissions")
    .select("permission_key")
    .eq("profile_id", profileId)
    .eq("permission_key", "gongang.manage")
    .maybeSingle();

  if (error) throw error;

  return data !== null;
}

export async function loadGongangSchedule(
  weekStart: string,
  weekEnd: string,
): Promise<GongangScheduleEntry[]> {
  const { data, error } = await getSupabase()
    .from("gongang_schedule")
    .select("schedule_date, slot, location, reserved, detail")
    .gte("schedule_date", weekStart)
    .lte("schedule_date", weekEnd);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    scheduleDate: row.schedule_date,
    slot: row.slot,
    location: row.location,
    reserved: row.reserved,
    detail: row.detail,
  }));
}

export async function saveGongangSchedule(
  entries: GongangScheduleEntry[],
): Promise<void> {
  const { error } = await getSupabase()
    .from("gongang_schedule")
    .upsert(
      entries.map((entry) => ({
        schedule_date: entry.scheduleDate,
        slot: entry.slot,
        location: entry.location,
        reserved: entry.reserved,
        detail: entry.reserved
          ? entry.detail?.trim()
            ? entry.detail.trim()
            : null
          : null,
      })),
      {
        onConflict: "schedule_date,slot,location",
      },
    );

  if (error) throw error;
}
