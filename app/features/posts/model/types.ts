import type { Database } from "~/shared/supabase/database.types";

type Functions = Database["public"]["Functions"];

type GroupPostRow = Functions["list_group_posts"]["Returns"][number];
type GroupPostDetailRow = Functions["get_group_post"]["Returns"][number];
type GroupPostSearchRow = Functions["search_group_posts"]["Returns"][number];
type PostAttachmentRow = Functions["list_post_attachments"]["Returns"][number];
export type PostAttachment = Omit<
  PostAttachmentRow,
  "height" | "width" | "ready_at"
> & {
  height: number | null;
  width: number | null;
  ready_at: string | null;
  signedUrl: string | null;
};
export type GroupPost = GroupPostRow & { attachments: PostAttachment[] };
// 검색 결과에는 댓글 수를 표시하지 않으므로(기능 명세 §8.9) 목록과 반환 모양이 다르다.
export type GroupPostSearchResult = GroupPostSearchRow;
export type GroupPostDetail = GroupPostDetailRow & {
  attachments: PostAttachment[];
};
export type GroupCategory =
  Database["public"]["Tables"]["group_categories"]["Row"];
export type PostIdentity = Database["public"]["Enums"]["post_identity"];

export interface PostCursor {
  publishedAt: string;
  postId: string;
  isPinned: boolean;
}

export interface GroupPostPage {
  posts: GroupPost[];
  nextCursor: PostCursor | null;
}

export interface PostFormValues {
  title: string;
  body: string;
  categoryId: string;
  authorIdentity: PostIdentity;
}

export interface PreparedPostFile {
  key: string;
  file: File;
  kind: "image" | "file";
  width: number | null;
  height: number | null;
  previewUrl: string | null;
}

export type PostSaveProgress =
  | "creating"
  | "updating"
  | "uploading"
  | "removing"
  | "ordering"
  | "publishing";

export type PostFormErrors = Partial<
  Record<"title" | "body" | "categoryId" | "authorIdentity" | "form", string>
>;

export type PostViewMode = "card" | "list";

type PostCommentRow = Functions["list_post_comments"]["Returns"][number];
/** 목록, 답글 묶음, 방금 작성한 댓글이 모두 같은 행 모양을 쓴다. */
export type PostComment = PostCommentRow;

export interface CommentCursor {
  createdAt: string;
  commentId: string;
}

export interface PostCommentPage {
  /** 오래된 것부터 최신 순. 화면에 그리는 순서와 같다. */
  comments: PostComment[];
  /** 이보다 더 오래된 댓글이 남아 있을 때의 커서. 없으면 스레드의 처음까지 불러온 것이다. */
  olderCursor: CommentCursor | null;
}
