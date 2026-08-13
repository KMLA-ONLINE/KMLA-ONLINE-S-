import type { Database } from "~/shared/supabase/database.types";

type Functions = Database["public"]["Functions"];

type GroupPostRow = Functions["list_group_posts"]["Returns"][number];
type GroupPostDetailRow = Functions["get_group_post"]["Returns"][number];
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
export type GroupPostDetail = GroupPostDetailRow & {
  attachments: PostAttachment[];
};
export type GroupCategory =
  Database["public"]["Tables"]["group_categories"]["Row"];
export type PostIdentity = Database["public"]["Enums"]["post_identity"];

export interface PostCursor {
  publishedAt: string;
  postId: string;
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
