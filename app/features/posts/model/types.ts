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
export type PostReaction = Database["public"]["Enums"]["post_reaction"];

/**
 * 게시물이나 댓글 하나의 반응 상태 (기능 명세 §10.1).
 *
 * `my_reaction`은 반응하지 않았으면 null이다. 생성기가 RPC의 `returns table` 컬럼을 전부
 * not null로 적어 내려서 직접 고쳐 준다 — 이 필드는 "안 눌렀다"가 기본 상태라 거짓 타입을
 * 그대로 두면 화면이 항상 반응한 것처럼 굴게 된다.
 */
export interface ReactionSummary {
  reaction_count: number;
  top_reactions: PostReaction[];
  my_reaction: PostReaction | null;
}

type WithReactions<Row> = Omit<Row, keyof ReactionSummary> & ReactionSummary;

export type GroupPost = WithReactions<GroupPostRow> & {
  attachments: PostAttachment[];
};
// 검색 결과에는 댓글 수와 반응을 표시하지 않으므로(기능 명세 §8.9) 목록과 반환 모양이 다르다.
export type GroupPostSearchResult = GroupPostSearchRow;
export type GroupPostDetail = WithReactions<GroupPostDetailRow> & {
  attachments: PostAttachment[];
};
type PostReactorRow = Functions["list_post_reactors"]["Returns"][number];
/**
 * 반응자 목록의 한 줄 (기능 명세 §10.3).
 *
 * 익명 줄은 개인을 드러내지 않고 종류별 인원수만 담는다 — `reactor_pub_id`가 null이면 익명
 * 묶음이고 `anonymous_count`가 채워진다. 실명 줄은 그 반대다.
 */
export type PostReactor = Omit<
  PostReactorRow,
  | "reactor_pub_id"
  | "reactor_name"
  | "reactor_avatar_path"
  | "reacted_at"
  | "anonymous_count"
> & {
  reactor_pub_id: string | null;
  reactor_name: string | null;
  reactor_avatar_path: string | null;
  reacted_at: string | null;
  anonymous_count: number | null;
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
export type PostComment = WithReactions<PostCommentRow>;

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
