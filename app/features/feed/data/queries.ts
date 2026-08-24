import { createPostAttachmentUrls } from "~/features/posts/data/files";
import type { PostAttachment } from "~/features/posts/model/types";
import { createProfileMediaUrls } from "~/features/profiles/data/media";
import type { FeedPage, FeedPost } from "~/features/feed/model/types";
import { getSupabase } from "~/shared/supabase/client";
import type { Json } from "~/shared/supabase/database.types";

function readAttachments(value: Json, postId: string): PostAttachment[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (
      !item ||
      Array.isArray(item) ||
      typeof item !== "object" ||
      typeof item.attachment_id !== "string" ||
      typeof item.object_path !== "string" ||
      typeof item.original_filename !== "string" ||
      typeof item.storage_bucket !== "string" ||
      typeof item.mime_type !== "string" ||
      typeof item.position !== "number" ||
      typeof item.size_bytes !== "number" ||
      typeof item.created_at !== "string"
    ) {
      return [];
    }

    return [
      {
        attachment_id: item.attachment_id,
        post_id: postId,
        storage_bucket: item.storage_bucket,
        object_path: item.object_path,
        original_filename: item.original_filename,
        position: item.position,
        mime_type: item.mime_type,
        size_bytes: item.size_bytes,
        width: typeof item.width === "number" ? item.width : null,
        height: typeof item.height === "number" ? item.height : null,
        status: "ready" as const,
        created_at: item.created_at,
        ready_at: typeof item.ready_at === "string" ? item.ready_at : null,
        signedUrl: null,
      },
    ];
  });
}

export async function listFeedPosts(
  pageToken: string | null = null,
): Promise<FeedPage> {
  const { data, error } = await getSupabase().rpc("list_feed_posts", {
    p_page_token: pageToken ?? undefined,
  });
  if (error) throw error;

  const rows = data ?? [];
  const withAttachments = rows.map((row) => ({
    ...row,
    attachments: readAttachments(row.attachments, row.post_id),
  }));
  const [attachmentUrls, profileUrls] = await Promise.all([
    createPostAttachmentUrls(
      withAttachments.flatMap((post) =>
        post.attachments.map((attachment) => attachment.object_path),
      ),
    ),
    createProfileMediaUrls(
      withAttachments.flatMap((post) => [
        post.author_avatar_path,
        post.activity_media_path,
      ]),
    ),
  ]);

  const posts = withAttachments.flatMap((row): FeedPost[] => {
    const common = {
      ...row,
      author_name: row.author_name ?? null,
      author_pub_id: row.author_pub_id ?? null,
      author_avatar_path: row.author_avatar_path
        ? (profileUrls.get(row.author_avatar_path) ?? null)
        : null,
      edited_at: row.edited_at ?? null,
      my_reaction: row.my_reaction ?? null,
      activity_media_url: row.activity_media_path
        ? (profileUrls.get(row.activity_media_path) ?? null)
        : null,
      attachments: row.attachments.map((attachment) => ({
        ...attachment,
        signedUrl: attachmentUrls.get(attachment.object_path) ?? null,
      })),
    };

    if (
      row.kind === "group" &&
      row.title &&
      row.group_id &&
      row.group_name &&
      row.group_slug
    ) {
      return [
        {
          ...common,
          kind: "group",
          title: row.title,
          group_id: row.group_id,
          group_name: row.group_name,
          group_slug: row.group_slug,
          category_name: row.category_name ?? null,
          timeline_name: null,
          timeline_pub_id: null,
          activity_kind: null,
          activity_media_path: null,
          activity_media_url: null,
          visibility: null,
        },
      ];
    }

    if (
      row.kind === "profile" &&
      row.timeline_name &&
      row.timeline_pub_id &&
      row.visibility === "public"
    ) {
      return [
        {
          ...common,
          kind: "profile",
          title: null,
          group_id: null,
          group_name: null,
          group_slug: null,
          category_name: null,
          timeline_name: row.timeline_name,
          timeline_pub_id: row.timeline_pub_id,
          activity_kind: row.activity_kind ?? null,
          activity_media_path: row.activity_media_path ?? null,
          visibility: "public",
        },
      ];
    }

    return [];
  });

  return {
    posts,
    feedEpoch: rows[0]?.feed_epoch ?? null,
    nextPageToken: rows[0]?.next_page_token ?? null,
  };
}
