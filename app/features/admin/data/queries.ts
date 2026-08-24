import type {
  AcceptedUser,
  AdminApplication,
  AdminMember,
} from "~/features/admin/model/types";
import { getSupabase } from "~/shared/supabase/client";

export async function assertAppAdmin(): Promise<void> {
  const { error } = await getSupabase().rpc("admin_list_accepted_users", {
    p_limit: 1,
    p_offset: 0,
  });
  if (error) throw error;
}

export async function listApplications(
  status: "pending" | "blocked",
  offset = 0,
): Promise<AdminApplication[]> {
  const { data, error } = await getSupabase().rpc("admin_list_applications", {
    p_status: status,
    p_limit: 200,
    p_offset: offset,
  });
  if (error) throw error;
  return data ?? [];
}

export async function listAcceptedUsers(
  query?: string,
  managersOnly = false,
): Promise<AcceptedUser[]> {
  const { data, error } = await getSupabase().rpc("admin_list_accepted_users", {
    p_query: query?.length ? query : undefined,
    p_limit: 200,
    p_offset: 0,
    p_managers_only: managersOnly,
  });
  if (error) throw error;
  return data ?? [];
}

export async function listAdminMembers(
  query?: string,
  adminsOnly = false,
): Promise<AdminMember[]> {
  const { data, error } = await getSupabase().rpc("admin_list_members", {
    p_query: query?.length ? query : undefined,
    p_limit: 200,
    p_offset: 0,
    p_admins_only: adminsOnly,
  });
  if (error) throw error;
  return data ?? [];
}
