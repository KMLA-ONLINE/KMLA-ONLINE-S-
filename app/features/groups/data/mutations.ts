import { getSupabase } from "~/shared/supabase/client";
import type {
  CreateGroupValues,
  GroupMemberRole,
  GroupMediaSlot,
  UpdateGroupSettingsValues,
} from "~/features/groups/model/types";
import { uploadGroupMedia } from "~/features/groups/data/files";

export async function createGroup(
  values: CreateGroupValues,
): Promise<{ groupId: string; slug: string }> {
  const { data, error } = await getSupabase().rpc("create_group", {
    p_kind: values.kind,
    p_name: values.name,
    p_description: values.description,
    p_slug: values.slug || undefined,
    p_join_policy: values.joinPolicy,
    p_identity_policy: values.identityPolicy,
    p_posting_policy: values.postingPolicy,
  });
  if (error) throw error;

  const group = data?.[0];
  if (!group) throw new Error("Created group was not returned");
  return { groupId: group.group_id, slug: group.slug };
}

export async function joinGroup(
  groupId: string,
  profileId: number,
): Promise<void> {
  const { error } = await getSupabase()
    .from("group_memberships")
    .insert({ group_id: groupId, profile_id: profileId });
  if (error) throw error;
}

export async function requestGroupJoin(
  groupId: string,
  profileId: number,
): Promise<void> {
  const { error } = await getSupabase()
    .from("group_join_requests")
    .insert({ group_id: groupId, profile_id: profileId });
  if (error) throw error;
}

export async function cancelGroupJoinRequest(
  groupId: string,
  profileId: number,
): Promise<void> {
  const { error } = await getSupabase()
    .from("group_join_requests")
    .delete()
    .eq("group_id", groupId)
    .eq("profile_id", profileId);
  if (error) throw error;
}

/**
 * 멤버십 행을 지우고 실제로 나갔는지 돌려준다. 공식 그룹과 소유자 멤버십은 RLS가
 * 막는데, 거부된 삭제는 오류가 아니라 0행 삭제로 돌아오므로 삭제 건수로 판단한다.
 */
export async function leaveGroup(
  groupId: string,
  profileId: number,
): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("group_memberships")
    .delete()
    .eq("group_id", groupId)
    .eq("profile_id", profileId)
    .select("group_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function setGroupPinned(
  groupId: string,
  profileId: number,
  pinned: boolean,
): Promise<void> {
  const { error } = await getSupabase()
    .from("group_memberships")
    .update({ pinned_at: pinned ? new Date().toISOString() : null })
    .eq("group_id", groupId)
    .eq("profile_id", profileId);
  if (error) throw error;
}

export async function approveGroupJoinRequest(
  groupId: string,
  requestId: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("approve_group_join_request", {
    p_group_id: groupId,
    p_request_id: requestId,
  });
  if (error) throw error;
}

export async function rejectGroupJoinRequest(
  groupId: string,
  requestId: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("reject_group_join_request", {
    p_group_id: groupId,
    p_request_id: requestId,
  });
  if (error) throw error;
}

export async function setGroupMemberRole(
  groupId: string,
  memberId: string,
  role: Exclude<GroupMemberRole, "owner">,
): Promise<void> {
  const { error } = await getSupabase().rpc("update_group_member_role", {
    p_group_id: groupId,
    p_membership_id: memberId,
    p_role: role,
  });
  if (error) throw error;
}

export async function transferGroupOwnership(
  groupId: string,
  memberId: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("transfer_group_ownership", {
    p_group_id: groupId,
    p_target_membership_id: memberId,
  });
  if (error) throw error;
}

export async function updateGroupSettings(
  groupId: string,
  values: UpdateGroupSettingsValues,
): Promise<void> {
  const { error } = await getSupabase().rpc("update_group_settings", {
    p_group_id: groupId,
    p_name: values.name,
    p_description: values.description,
    p_join_policy: values.joinPolicy,
    p_identity_policy: values.identityPolicy,
    p_posting_policy: values.postingPolicy,
  });
  if (error) throw error;
}

export async function replaceGroupMedia(
  groupId: string,
  slot: GroupMediaSlot,
  file: File,
  dimensions: { width: number; height: number },
): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("prepare_group_media", {
    p_group_id: groupId,
    p_slot: slot,
    p_size_bytes: file.size,
    p_width: dimensions.width,
    p_height: dimensions.height,
  });
  if (error) throw error;
  const prepared = data?.[0];
  if (!prepared) throw new Error("Group media upload was not prepared");

  await uploadGroupMedia(prepared.object_path, file);
  const { error: finalizeError } = await supabase.rpc("finalize_group_media", {
    p_media_id: prepared.media_id,
  });
  if (finalizeError) throw finalizeError;
}

export async function removeGroupMedia(
  groupId: string,
  slot: GroupMediaSlot,
): Promise<void> {
  const { error } = await getSupabase().rpc("remove_group_media", {
    p_group_id: groupId,
    p_slot: slot,
  });
  if (error) throw error;
}
