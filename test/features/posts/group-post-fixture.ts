import type { GroupPost } from "~/features/posts/model/types";

export function groupPost(overrides: Partial<GroupPost> = {}): GroupPost {
  return {
    attachments: [],
    author_avatar_path: null as unknown as string,
    author_identity: "identified",
    author_label: "익명",
    author_name: "김서민",
    author_pub_id: "author-pub-id",
    body: "본문",
    can_delete: false,
    can_edit: false,
    can_pin: false,
    category_id: null as unknown as string,
    category_name: null as unknown as string,
    comment_count: 0,
    edited_at: null as unknown as string,
    group_id: "group-id",
    is_author: false,
    is_pinned: false,
    post_id: "post-id",
    published_at: "2026-08-13T00:00:00Z",
    title: "제목",
    ...overrides,
  };
}
