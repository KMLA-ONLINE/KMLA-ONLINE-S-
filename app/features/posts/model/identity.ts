import type { Database } from "~/shared/supabase/database.types";

import type { PostIdentity } from "~/features/posts/model/types";

type GroupIdentityPolicy = "identified" | "optional_anonymous";
type GroupMemberRole = Database["public"]["Enums"]["group_member_role"];

/** 그룹 신원 정책과 내 역할로 고를 수 있는 작성 신원(기능 명세 §8.5, §8.6, §9.1). 게시물과 댓글이 같은 규칙을 쓰며, 실제 판정은 RPC가 한다. */
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

/**
 * 게시물 머리에 적는 작성자 이름. 익명·탈퇴처럼 이름이 비면 서버가 내려준 라벨로 대신한다.
 * `??`가 아니라 `||`인 것은 빈 문자열도 "이름 없음"이기 때문이다.
 */
export function postAuthorName(post: {
  author_name: string | null;
  author_label: string;
}): string {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 빈 문자열도 이름 없음이다.
  return post.author_name || post.author_label;
}
