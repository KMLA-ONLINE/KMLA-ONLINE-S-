import type { ProfilePost } from "~/features/posts/model/types";

/** 작성자 계정이 사라지면 프로필 join이 비어 돌아온다. 자리를 비워 두면 시각만 뜬 카드가 된다. */
const UNKNOWN_PROFILE_AUTHOR = "알 수 없는 사용자";

export function profilePostAuthorName(post: ProfilePost): string {
  return post.author_name ?? UNKNOWN_PROFILE_AUTHOR;
}

export function profilePostPath(post: ProfilePost): string {
  return `/profile/${post.timeline_pub_id}/posts/${post.post_id}`;
}
