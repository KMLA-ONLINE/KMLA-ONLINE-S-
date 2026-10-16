/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Edge-only JSR modules are checked by Deno. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.111.0";
import { createSyncHandler, type SchoolCredentials } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const syncSecret = Deno.env.get("SCHOOL_NOTICE_SYNC_SECRET") ?? "";

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 자격증명과 학교 세션 쿠키는 이 실행의 메모리에만 있다. 로그로 남기지 않는다.
async function loadCredentials(): Promise<SchoolCredentials | null> {
  const { data, error } = await supabase.rpc("school_notice_credentials");
  if (error) throw new Error("credentials_unavailable");
  const row = (data ?? [])[0] as
    { login_id: string; password: string } | undefined;
  return row ? { loginId: row.login_id, password: row.password } : null;
}

Deno.serve(
  createSyncHandler({
    expectedSecret: syncSecret,
    fetch,
    loadCredentials,
    report: async (result) => {
      const { error } = await supabase.rpc("record_school_notice_sync", {
        p_notices: "notices" in result ? result.notices : null,
        p_error: "error" in result ? result.error : null,
      });
      if (error) throw new Error("report_failed");
    },
  }),
);
