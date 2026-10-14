import type { AdminContact } from "~/features/support/model/admin-contacts";
import { getSupabase } from "~/shared/supabase/client";

/** 로그인 전에도 읽는다. 테이블은 `anon`에 SELECT가 열려 있다. */
export async function listAdminContacts(): Promise<AdminContact[]> {
  const { data, error } = await getSupabase()
    .from("admin_contacts")
    .select("kind, label, value")
    .order("position");
  if (error) throw error;
  return (data ?? []) as AdminContact[];
}
