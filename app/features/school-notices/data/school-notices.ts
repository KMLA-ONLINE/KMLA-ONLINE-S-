import type { Database } from "~/shared/supabase/database.types";
import { getSupabase } from "~/shared/supabase/client";

type RawSchoolNotice =
  Database["public"]["Functions"]["list_school_notices"]["Returns"][number];

/** 동기화가 한 번도 성공하지 않았으면 `synced_at`이 NULL이다. 생성 타입은 이를 non-null로 적는다. */
export type SchoolNotice = Omit<RawSchoolNotice, "synced_at"> & {
  synced_at: string | null;
};

export async function listSchoolNotices(): Promise<SchoolNotice[]> {
  const { data, error } = await getSupabase().rpc("list_school_notices");
  if (error) throw error;
  return data ?? [];
}
