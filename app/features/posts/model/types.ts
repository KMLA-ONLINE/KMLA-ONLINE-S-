import type {
  MentionDraftEntry,
  PostMention,
} from "~/features/posts/model/mentions";
import type { Database } from "~/shared/supabase/database.types";

type Functions = Database["public"]["Functions"];

type GroupPostRow = Functions["list_group_posts"]["Returns"][number];
type GroupPostDetailRow = Functions["get_group_post"]["Returns"][number];
type GroupPostSearchRow = Functions["search_group_posts"]["Returns"][number];
type PostAttachmentRow = Functions["list_post_attachments"]["Returns"][number];
export type PostAttachment = Pick<
  PostAttachmentRow,
  | "attachment_id"
  | "post_id"
  | "storage_bucket"
  | "object_path"
  | "original_filename"
  | "position"
  | "mime_type"
  | "size_bytes"
> & {
  height: number | null;
  width: number | null;
  status?: PostAttachmentRow["status"];
  created_at?: PostAttachmentRow["created_at"];
  ready_at?: PostAttachmentRow["ready_at"] | null;
  /** 원본의 signed URL. 이미지 뷰어와 다운로드가 쓴다. */
  signedUrl: string | null;
  /** 축소본 object 경로. 이미지가 아니거나 축소본 업로드가 실패했으면 `null`이다. */
  thumbnail_path: string | null;
  /** 축소본 signed URL. 목록 `<img>`가 먼저 쓰고 없으면 `signedUrl`로 떨어진다. */
  thumbnailUrl: string | null;
};
export type PostReaction = Database["public"]["Enums"]["post_reaction"];

/** 게시물·댓글 하나의 반응 상태. `my_reaction`은 안 눌렀으면 null이다(생성기가 not null로 적어 고쳐 준다). */
export interface ReactionSummary {
  reaction_count: number;
  top_reactions: PostReaction[];
  my_reaction: PostReaction | null;
}

export type PostEngagement = ReactionSummary & {
  comment_count: number;
};

type WithReactions<Row> = Omit<Row, keyof ReactionSummary> & ReactionSummary;

/**
 * 아바타는 원시 path(`author_avatar_path`)와 서명 URL(`author_avatar_url`)을 따로 든다 — 한 필드에 덮어쓰면 다시 채울 때 서명이 실패해 아바타가 null이 된다.
 * `<img src>`에는 `author_avatar_url`만 쓴다. path가 null 가능한 것은 생성기 때문이다(`ProfilePost`와 동일).
 */
export type GroupPost = WithReactions<
  Omit<
    GroupPostRow,
    | "author_avatar_path"
    | "anonymous_author_restriction_expires_at"
    | "mentions"
  >
> & {
  author_avatar_path: string | null;
  author_avatar_url: string | null;
  anonymous_author_restriction_expires_at: string | null;
  attachments: PostAttachment[];
  mentions: PostMention[];
};
// 검색 결과에는 댓글 수와 반응을 표시하지 않으므로(기능 명세 §8.9) 목록과 반환 모양이 다르다.
export type GroupPostSearchResult = GroupPostSearchRow;
export type GroupPostDetail = WithReactions<
  Omit<
    GroupPostDetailRow,
    | "author_avatar_path"
    | "anonymous_author_restriction_expires_at"
    | "mentions"
  >
> & {
  author_avatar_path: string | null;
  author_avatar_url: string | null;
  anonymous_author_restriction_expires_at: string | null;
  attachments: PostAttachment[];
  mentions: PostMention[];
};
export type PostVisibility = Database["public"]["Enums"]["post_visibility"];
export type ProfileMediaActivityKind =
  Database["public"]["Enums"]["profile_media_activity_kind"];

type ProfilePostRow = Functions["list_profile_posts"]["Returns"][number];
/**
 * 프로필 타임라인의 개인 게시물. 목록과 상세가 같은 RPC 투영(`private.read_profile_posts`)을 쓴다.
 * `author_*`는 left join이라 계정이 사라지면 null이다(생성기가 not null로 적어 고쳐 준다).
 */
export type ProfilePost = WithReactions<
  Omit<
    ProfilePostRow,
    | "activity_kind"
    | "activity_media_path"
    | "author_pub_id"
    | "author_name"
    | "author_avatar_path"
    | "edited_at"
  >
> & {
  activity_kind: ProfileMediaActivityKind | null;
  activity_media_path: string | null;
  activity_media_url: string | null;
  author_pub_id: string | null;
  author_name: string | null;
  author_avatar_path: string | null;
  author_avatar_url: string | null;
  edited_at: string | null;
  attachments: PostAttachment[];
};

export interface ProfilePostCursor {
  publishedAt: string;
  postId: string;
}

export interface ProfilePostPage {
  posts: ProfilePost[];
  nextCursor: ProfilePostCursor | null;
}

export interface ProfilePostFormValues {
  body: string;
  visibility: PostVisibility;
}

export type ProfilePostFormErrors = Partial<
  Record<"body" | "visibility" | "form", string>
>;

/** 반응자 목록의 개별 행. 탈퇴한 사용자의 표현 필드는 null이다. */
export interface PostReactor {
  reaction: PostReaction;
  reactor_pub_id: string | null;
  reactor_name: string | null;
  reactor_avatar_path: string | null;
  /** 서명된 아바타 URL. 화면은 이쪽만 읽는다. */
  reactor_avatar_url: string | null;
  reacted_at: string;
}
export type GroupCategory =
  Database["public"]["Tables"]["group_categories"]["Row"];
export type PostIdentity = Database["public"]["Enums"]["post_identity"];
export type AnonymousActivityRestriction =
  Database["public"]["Functions"]["get_my_group_anonymous_activity_restriction"]["Returns"][number];
export type AnonymousActivitySourceKind = "post" | "comment";

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
  /** 본문 `(m:<ordinal>)` 토큰의 대상들(기능 명세 §8.14). 저장 직전 `normalizeMentions()`가 추리므로 고른 대상이 그대로 쌓여 있어도 된다. */
  mentions: MentionDraftEntry[];
}

export interface PreparedPostFile {
  key: string;
  file: File;
  /** 목록용 축소본. 이미지가 아니거나 생성에 실패하면 `null`이고 목록도 원본을 그린다 — 글 전체가 실패하는 것보다 낫다. */
  thumbnail: File | null;
  /** 원본 WebP를 올리는 동안 병렬로 만드는 목록용 축소본. */
  thumbnailPromise?: Promise<File | null>;
  /** 항목을 지우거나 작성 화면을 닫으면 남은 이미지 인코딩도 중단한다. */
  abortPreparation?: () => void;
  kind: "image" | "file";
  width: number | null;
  height: number | null;
  previewUrl: string | null;
}

export type PostFileUploadStatus = "queued" | "uploading" | "ready" | "error";

export interface PostFileUploadState {
  status: PostFileUploadStatus;
  progress: number;
  error?: string;
}

export interface PreparedCommentImage extends PreparedPostFile {
  kind: "image";
  width: number;
  height: number;
  previewUrl: string;
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
export interface CommentImage {
  image_id: string;
  comment_id: string;
  post_id: string;
  storage_bucket: string;
  object_path: string;
  mime_type: string;
  size_bytes: number;
  width: number;
  height: number;
  ready_at: string;
  signedUrl: string | null;
}

/** 목록, 답글 묶음, 방금 작성한 댓글이 모두 같은 행 모양을 쓴다. */
export type PostComment = WithReactions<
  Omit<
    PostCommentRow,
    | "anonymous_author_restriction_expires_at"
    | "author_avatar_path"
    | "mentions"
  >
> & {
  anonymous_author_restriction_expires_at: string | null;
  author_avatar_path: string | null;
  /** 게시물과 같은 규칙이다 — 화면은 이쪽만 읽는다. `GroupPost`의 주석을 보라. */
  author_avatar_url: string | null;
  images: CommentImage[];
  mentions: PostMention[];
};

/** 댓글 생성 응답. `commentCount`는 insert 트리거가 갱신한 정본이므로 낡은 값에 `+1` 하지 않고 이 값을 쓴다. */
export interface CreatedPostComment {
  comment: PostComment;
  commentCount: number;
}

export type CommentImageInput = CommentImage | PreparedCommentImage | null;

export interface CommentCursor {
  createdAt: string;
  commentId: string;
}

export interface PostCommentPage {
  /** 오래된 것부터 최신 순. 화면에 그리는 순서와 같다. */
  comments: PostComment[];
  /** 이보다 더 최신 댓글이 남아 있을 때의 커서. 없으면 스레드의 끝까지 불러온 것이다. */
  nextCursor: CommentCursor | null;
}
