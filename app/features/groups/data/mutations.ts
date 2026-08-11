import { getSupabase } from "~/shared/supabase/client";
import type { CreateGroupValues } from "~/features/groups/model/types";

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
