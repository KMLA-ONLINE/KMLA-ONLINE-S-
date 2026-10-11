import type {
  GroupPostDetail,
  PostAttachment,
  PostCommentPage,
  ProfilePost,
} from "~/features/posts/model/types";
import type { PostMention } from "~/features/posts/model/mentions";
import type {
  GroupIdentityPolicy,
  GroupMemberRole,
} from "~/features/groups/model/types";
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
type FeedBase = Omit<
  FeedRow,
  NullableColumns | "attachments" | "kind" | "mentions"
> & {
  author_avatar_path: string | null;
  /**
   * 서명된 아바타 URL. 화면은 언제나 이쪽만 읽는다 —
   * `~/features/posts/model/types`의 `GroupPost` 주석이 이유를 적어 두었다.
   */
  author_avatar_url: string | null;
  author_name: string | null;
  author_pub_id: string | null;
  edited_at: string | null;
  my_reaction: FeedRow["my_reaction"] | null;
  attachments: PostAttachment[];
  mentions: PostMention[];
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

/**
 * 피드 상세 창의 내용. `comments`가 null이면 피드가 든 글로 먼저 그린 미리보기다 — 댓글과
 * 권한(`can_*`)은 상세 응답이 와야 채워진다.
 */
export type FeedPostDetail =
  | {
      kind: "group";
      post: GroupPostDetail;
      comments: PostCommentPage | null;
      slug: string;
      groupName: string;
      /** 댓글 작성 신원을 정할 그룹 정책. 미리보기에는 없다. */
      group: {
        groupId: string;
        identityPolicy: GroupIdentityPolicy;
        memberRole: GroupMemberRole | null;
      } | null;
    }
  | {
      kind: "profile";
      post: ProfilePost;
      comments: PostCommentPage | null;
    };

export interface FeedPostDetailResult {
  requestedPostId: string;
  detail: FeedPostDetail | null;
  error: string | null;
}
