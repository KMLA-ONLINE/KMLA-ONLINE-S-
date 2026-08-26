import { createProfileMediaUrls } from "~/features/profiles/data/media";
import { getSupabase } from "~/shared/supabase/client";

export interface AbsenceItem {
  pubId: string;
  name: string;
  avatarUrl: string | null;
  reason: string;
}

export async function listTodayAbsences(): Promise<AbsenceItem[]> {
  const { data, error } = await getSupabase().rpc("list_today_absences");

  if (error) throw error;

  const rows = data ?? [];
  const mediaUrls = await createProfileMediaUrls(
    rows.map((row) => row.avatar_path),
  );

  return rows.map((row) => ({
    pubId: row.pub_id,
    name: row.name,
    avatarUrl: row.avatar_path
      ? (mediaUrls.get(row.avatar_path) ?? null)
      : null,
    reason: row.reason,
  }));
}
