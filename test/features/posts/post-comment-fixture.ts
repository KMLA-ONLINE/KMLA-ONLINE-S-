import type { PostComment } from "~/features/posts/model/types";

export function postComment(overrides: Partial<PostComment> = {}): PostComment {
  return {
    author_avatar_path: null as unknown as string,
    author_identity: "identified",
    author_label: "이한별",
    author_name: "이한별",
    author_pub_id: "hanbyeol-25",
    body: "댓글 본문",
    can_delete: false,
    can_edit: false,
    comment_id: "comment-id",
    created_at: "2026-08-13T02:00:00Z",
    depth: 0,
    edited_at: null as unknown as string,
    is_author: false,
    is_deleted: false,
    images: [],
    parent_author_label: null as unknown as string,
    parent_comment_id: null as unknown as string,
    my_reaction: null,
    post_id: "post-id",
    reaction_count: 0,
    reply_count: 0,
    root_comment_id: "comment-id",
    top_reactions: [],
    ...overrides,
  };
}
