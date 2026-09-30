import { getSupabase } from "~/shared/supabase/client";
import type {
  CreateGroupValues,
  GroupInvite,
  GroupInviteProfileType,
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
    p_hide_staff_roles: values.hideStaffRoles,
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

export async function markGroupPostsVisited(groupId: string): Promise<void> {
  const { error } = await getSupabase().rpc("mark_group_posts_visited", {
    p_group_id: groupId,
  });
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

/** 멤버십 행을 지우고 실제로 나갔는지 돌려준다. RLS가 막은 삭제는 오류가 아니라 0행이라 삭제 건수로 판단한다. */
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

/** 그룹을 없앤다(소유자만). 서버가 tombstone을 남기고 멤버십을 지워 저장소 청소 워커가 이미지를 회수한다. */
export async function deleteGroup(groupId: string): Promise<void> {
  const { error } = await getSupabase().rpc("delete_group", {
    p_group_id: groupId,
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
    p_hide_staff_roles: values.hideStaffRoles,
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

/** 초대 링크를 만들거나 다시 만든다. 그룹당 한 행이라 재발급이 곧 무효화다. 유효 기간 1~336시간은 서버도 검사한다. */
export async function issueGroupInvite(
  groupId: string,
  hours: number,
  allowedProfileTypes: GroupInviteProfileType[],
): Promise<GroupInvite> {
  const { data, error } = await getSupabase().rpc("issue_group_invite", {
    p_group_id: groupId,
    p_hours: hours,
    p_allowed_profile_types: allowedProfileTypes,
  });
  if (error) throw error;

  const invite = data?.[0];
  if (!invite) throw new Error("Issued group invite was not returned");
  return invite;
}

/** 초대 링크를 끊는다. 재발급과 달리 새 링크를 남기지 않는다. */
export async function revokeGroupInvite(groupId: string): Promise<void> {
  const { error } = await getSupabase().rpc("revoke_group_invite", {
    p_group_id: groupId,
  });
  if (error) throw error;
}

/** 초대를 수락하고 들어간 그룹의 주소를 돌려준다. 이미 멤버면 역할이 유지되고, 대기 중이던 가입 요청은 걷힌다. */
export async function acceptGroupInvite(token: string): Promise<string> {
  const { data, error } = await getSupabase().rpc("accept_group_invite", {
    p_token: token,
  });
  if (error) throw error;
  if (!data) throw new Error("Accepted group invite did not return a slug");
  return data;
}
