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

export interface SchoolNoticeAttachment {
  attachment_id: number;
  name: string;
  size: number;
}

type RawSchoolNoticeDetail =
  Database["public"]["Functions"]["get_school_notice"]["Returns"][number];

/** `attachments`는 생성 타입에서 Json이다. DB가 `[{attachment_id, name, size}]` 모양으로만 저장한다. */
export type SchoolNoticeDetail = Omit<RawSchoolNoticeDetail, "attachments"> & {
  attachments: SchoolNoticeAttachment[];
};

/** 목록에서 빠졌거나 승인 전이면 null이다. */
export async function getSchoolNotice(
  postId: number,
): Promise<SchoolNoticeDetail | null> {
  const { data, error } = await getSupabase().rpc("get_school_notice", {
    p_post_id: postId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    ...row,
    attachments: Array.isArray(row.attachments)
      ? (row.attachments as unknown as SchoolNoticeAttachment[])
      : [],
  };
}
