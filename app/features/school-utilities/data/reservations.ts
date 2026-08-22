import { getSupabase } from "~/shared/supabase/client";

export type UtilityMode = "gongang" | "karaoke";

export interface UtilityReservation {
  id: number;
  profileId: number;
  mode: UtilityMode;
  reservationDate: string;
  slot: string;
  location: string | null;
  detail: string;
  recurring: boolean;
  applicantName: string;
  /** 신청자 기수. 이름은 예약 행에 복사돼 있지만 기수는 프로필에서 읽어 온다. */
  applicantCohort: number | null;
  avatarUrl: string | null;
}

interface CreateUtilityReservationInput {
  profileId: number;
  mode: UtilityMode;
  reservationDate: string;
  slot: string;
  location: string | null;
  detail: string;
  recurring: boolean;
}

const SELECT_COLUMNS =
  "id, profile_id, mode, reservation_date, slot, location, detail, recurring, applicant_name, avatar_path, profiles(cohort)" as const;

function toMode(value: string): UtilityMode {
  if (value === "gongang" || value === "karaoke") {
    return value;
  }

  throw new Error("Unknown utility reservation mode.");
}

async function resolveAvatarUrl(path: string | null): Promise<string | null> {
  if (!path) return null;

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const { data, error } = await getSupabase()
    .storage.from("profile-media")
    .createSignedUrl(path, 3600);

  if (error) return null;

  return data.signedUrl;
}

async function mapReservation(row: {
  id: number;
  profile_id: number;
  mode: string;
  reservation_date: string;
  slot: string;
  location: string | null;
  detail: string;
  recurring: boolean;
  applicant_name: string;
  avatar_path: string | null;
  profiles: { cohort: number | null } | null;
}): Promise<UtilityReservation> {
  return {
    id: row.id,
    profileId: row.profile_id,
    mode: toMode(row.mode),
    reservationDate: row.reservation_date,
    slot: row.slot,
    location: row.location,
    detail: row.detail,
    recurring: row.recurring,
    applicantName: row.applicant_name,
    applicantCohort: row.profiles?.cohort ?? null,
    avatarUrl: await resolveAvatarUrl(row.avatar_path),
  };
}

export async function loadUtilityReservations(
  mode: UtilityMode,
  weekStart: string,
  weekEnd: string,
): Promise<UtilityReservation[]> {
  const supabase = getSupabase();

  const [directResult, recurringResult] = await Promise.all([
    supabase
      .from("utility_reservations")
      .select(SELECT_COLUMNS)
      .eq("mode", mode)
      .eq("recurring", false)
      .gte("reservation_date", weekStart)
      .lte("reservation_date", weekEnd),

    supabase
      .from("utility_reservations")
      .select(SELECT_COLUMNS)
      .eq("mode", mode)
      .eq("recurring", true)
      .lte("reservation_date", weekEnd),
  ]);

  if (directResult.error) {
    throw directResult.error;
  }

  if (recurringResult.error) {
    throw recurringResult.error;
  }

  const rows = [...(directResult.data ?? []), ...(recurringResult.data ?? [])];

  return Promise.all(rows.map((row) => mapReservation(row)));
}

export async function createUtilityReservation(
  input: CreateUtilityReservationInput,
): Promise<UtilityReservation> {
  const { data, error } = await getSupabase()
    .from("utility_reservations")
    .insert({
      profile_id: input.profileId,
      mode: input.mode,
      reservation_date: input.reservationDate,
      slot: input.slot,
      location: input.location,
      detail: input.detail,
      recurring: input.recurring,

      // DB trigger가 실제 로그인 프로필 값으로 덮어쓴다.
      applicant_name: "",
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  return mapReservation(data);
}

export async function deleteUtilityReservation(
  reservationId: number,
): Promise<void> {
  const { data, error } = await getSupabase()
    .from("utility_reservations")
    .delete()
    .eq("id", reservationId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("예약을 취소할 수 없습니다.");
  }
}
