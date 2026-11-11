import { getSupabase } from "~/shared/supabase/client";

export interface GongangScheduleEntry {
  scheduleDate: string;
  slot: string;
  location: string;
  reserved: boolean;
  detail: string | null;
  recurring: boolean;
  recurringUntil: string | null;
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
export interface GongangManager {
  profileId: number;
  /** 기수가 있으면 "30기 이름", 없으면 이름만. */
  label: string;
}
/**
 * 예약 화면에 안내할 공강 담당자. 운영자(앱 관리자)도 선예약할 수 있지만
 * 역할로 얻는 접근이라 권한 행이 없고, 명단에는 전용 권한을 받은 사람만 나온다.
 * 보는 사람이 명단에 있는지도 여기서 알 수 있어 따로 권한을 조회하지 않는다.
 */
export async function loadGongangManagers(): Promise<GongangManager[]> {
  const { data, error } = await getSupabase()
    .from("profile_permissions")
    .select("profile_id, profile:profiles!inner(name, cohort)")
    .eq("permission_key", "gongang.manage")
    .order("created_at")
    .order("profile_id");
  if (error) throw error;
  return data.map(({ profile_id, profile }) => ({
    profileId: profile_id,
    label:
      profile.cohort === null
        ? profile.name
        : `${profile.cohort}기 ${profile.name}`,
  }));
}
export async function loadGongangSchedule(
  weekStart: string,
  weekEnd: string,
): Promise<GongangScheduleEntry[]> {
  const { data, error } = await getSupabase()
    .from("gongang_schedule")
    .select(
      "schedule_date, slot, location, reserved, detail, recurring, recurring_until",
    )
    .lte("schedule_date", weekEnd)
    .or(`recurring.eq.true,schedule_date.gte.${weekStart}`)
    .or(`recurring_until.is.null,recurring_until.gt.${weekStart}`);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    scheduleDate: row.schedule_date,
    slot: row.slot,
    location: row.location,
    reserved: row.reserved,
    detail: row.detail,
    recurring: row.recurring,
    recurringUntil: row.recurring_until,
  }));
}
export async function saveGongangSchedule(
  entries: GongangScheduleEntry[],
): Promise<void> {
  const { error } = await getSupabase().rpc("save_gongang_schedule", {
    p_entries: entries.map((entry) => ({
      schedule_date: entry.scheduleDate,
      slot: entry.slot,
      location: entry.location,
      reserved: entry.reserved,
      detail: entry.reserved ? entry.detail?.trim() : null,
      recurring: entry.recurring,
    })),
  });
  if (error) throw error;
}
