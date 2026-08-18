import type { ProfilePost } from "~/features/posts/model/types";

export function profilePost(overrides: Partial<ProfilePost> = {}): ProfilePost {
  return {
    attachments: [],
    author_avatar_path: null,
    author_name: "김서민",
    author_pub_id: "seomin-30",
    body: "본문",
    can_delete: false,
    can_edit: false,
    comment_count: 0,
    edited_at: null,
    is_author: false,
    my_reaction: null,
    post_id: "post-id",
    published_at: "2026-08-18T00:00:00Z",
    reaction_count: 0,
    timeline_name: "이지은",
    timeline_pub_id: "jieun-29",
    top_reactions: [],
    visibility: "public",
    ...overrides,
  };
}
