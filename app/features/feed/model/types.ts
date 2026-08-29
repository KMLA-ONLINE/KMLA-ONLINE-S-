import type {
  GroupPostDetail,
  PostAttachment,
  PostCommentPage,
  PostIdentity,
  ProfilePost,
} from "~/features/posts/model/types";
import type { Database } from "~/shared/supabase/database.types";

type FeedRow =
  Database["public"]["Functions"]["list_feed_posts"]["Returns"][number];

type NullableColumns =
  | "activity_kind"
  | "activity_media_path"
  | "author_avatar_path"
  | "author_name"
  | "author_pub_id"
  | "category_name"
  | "edited_at"
  | "group_id"
  | "group_name"
  | "group_slug"
  | "my_reaction"
  | "next_page_token"
  | "timeline_name"
  | "timeline_pub_id"
  | "title"
  | "visibility";

/** Postgres `returns table` nullability is not represented by generated types. */
type FeedBase = Omit<FeedRow, NullableColumns | "attachments" | "kind"> & {
  author_avatar_path: string | null;
  author_name: string | null;
  author_pub_id: string | null;
  edited_at: string | null;
  my_reaction: FeedRow["my_reaction"] | null;
  attachments: PostAttachment[];
};

export type GroupFeedPost = FeedBase & {
  kind: "group";
  title: string;
  group_id: string;
  group_name: string;
  group_slug: string;
  category_name: string | null;
  timeline_name: null;
  timeline_pub_id: null;
  activity_kind: null;
  activity_media_path: null;
  activity_media_url: null;
  visibility: null;
};

export type ProfileFeedPost = FeedBase & {
  kind: "profile";
  title: null;
  group_id: null;
  group_name: null;
  group_slug: null;
  category_name: null;
  timeline_name: string;
  timeline_pub_id: string;
  activity_kind: FeedRow["activity_kind"] | null;
  activity_media_path: string | null;
  activity_media_url: string | null;
  visibility: "public";
};

export type FeedPost = GroupFeedPost | ProfileFeedPost;

export interface FeedPage {
  posts: FeedPost[];
  feedEpoch: string | null;
  nextPageToken: string | null;
}

export type FeedPostDetail =
  | {
      kind: "group";
      post: GroupPostDetail;
      comments: PostCommentPage;
      slug: string;
      groupName: string;
      groupId: string;
      identities: PostIdentity[];
    }
  | {
      kind: "profile";
      post: ProfilePost;
      comments: PostCommentPage;
    };

export interface FeedPostDetailResult {
  requestedPostId: string;
  detail: FeedPostDetail | null;
  error: string | null;
}
