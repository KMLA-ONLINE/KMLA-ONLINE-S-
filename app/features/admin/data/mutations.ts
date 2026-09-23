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
