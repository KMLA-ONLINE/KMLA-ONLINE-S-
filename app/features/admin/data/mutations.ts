import type { AdminContact } from "~/features/support";
import type { Json } from "~/shared/supabase/database.types";
import { getSupabase } from "~/shared/supabase/client";

export async function reviewApplications(
  profileIds: number[],
  status: "accepted" | "blocked",
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_review_applications", {
    p_profile_ids: profileIds,
    p_status: status,
  });
  if (error) throw error;
}

export async function unblockApplication(profileId: number): Promise<void> {
  const { error } = await getSupabase().rpc("admin_unblock_application", {
    p_profile_id: profileId,
  });
  if (error) throw error;
}

export async function setGongangManager(
  profileId: number,
  enabled: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_gongang_manager", {
    p_profile_id: profileId,
    p_enabled: enabled,
  });
  if (error) throw error;
}

export async function setAppAdmin(
  profileId: number,
  enabled: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_app_admin", {
    p_profile_id: profileId,
    p_enabled: enabled,
  });
  if (error) throw error;
}

/** `days`가 `null`이면 무기한 정지다. */
export async function suspendProfile(
  profileId: number,
  reason: string,
  days: number | null,
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_suspend_profile", {
    p_profile_id: profileId,
    p_reason: reason,
    // 생성 타입은 인자를 non-null로 적지만 RPC는 `null`을 무기한으로 받는다.
    p_duration_days: days!,
  });
  if (error) throw error;
}

export async function liftSuspension(profileId: number): Promise<void> {
  const { error } = await getSupabase().rpc("admin_lift_suspension", {
    p_profile_id: profileId,
  });
  if (error) throw error;
}

export async function reauthenticateWithPassword(
  password: string,
): Promise<void> {
  const supabase = getSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user?.email) throw new Error("Current account has no email");

  const { error } = await supabase.auth.signInWithPassword({
    email: userData.user.email,
    password,
  });
  if (error) throw error;
}

export async function replaceAdminContacts(
  contacts: AdminContact[],
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_replace_contacts", {
    p_contacts: contacts as unknown as Json,
  });
  if (error) throw error;
}

/** 비밀번호는 저장만 한다. 서버는 저장한 비밀번호를 다시 돌려주지 않는다. */
export async function setSchoolNoticeAccount(
  loginId: string,
  password: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("admin_set_school_notice_account", {
    p_login_id: loginId,
    p_password: password,
  });
  if (error) throw error;
}

export async function syncSchoolNotices(): Promise<void> {
  const { error } = await getSupabase().rpc("admin_sync_school_notices");
  if (error) throw error;
}
