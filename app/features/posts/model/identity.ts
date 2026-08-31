import type { Database } from "~/shared/supabase/database.types";

import type { PostIdentity } from "~/features/posts/model/types";

type GroupIdentityPolicy = "identified" | "optional_anonymous";
type GroupMemberRole = Database["public"]["Enums"]["group_member_role"];

/**
 * 그룹 신원 정책과 내 역할로 고를 수 있는 작성 신원.
 *
 * 게시물과 댓글이 같은 규칙을 쓴다(기능 명세 §8.5, §8.6, §9.1). 두 화면이 각자 계산하면
 * 언젠가 한쪽만 고쳐진다. 실제 판정은 RPC 안에 있고 여기는 화면에 무엇을 띄울지만 정한다.
 */
export function resolveIdentityOptions(
  identityPolicy: GroupIdentityPolicy,
  memberRole: GroupMemberRole | null,
  anonymousRestricted = false,
): PostIdentity[] {
  const identities: PostIdentity[] =
    identityPolicy === "optional_anonymous" && !anonymousRestricted
      ? ["identified", "anonymous"]
      : ["identified"];
  if (memberRole && memberRole !== "member") identities.push("staff");
  return identities;
}
