import type {
  GroupCategory,
  GroupPost,
  GroupPostDetail,
  GroupPostPage,
  PostCursor,
} from "~/features/posts/model/types";
import type { PostAttachment } from "~/features/posts/model/types";
import { createPostAttachmentUrls } from "~/features/posts/data/files";
import { getSupabase } from "~/shared/supabase/client";

export const GROUP_POST_PAGE_SIZE = 12;

async function attachFiles<T extends { post_id: string }>(
  posts: T[],
): Promise<(T & { attachments: PostAttachment[] })[]> {
  if (posts.length === 0) return [];
  const { data, error } = await getSupabase()
    .from("post_attachments")
    .select(
      "id,post_id,storage_bucket,object_path,original_filename,position,mime_type,size_bytes,width,height,status,created_at,ready_at",
    )
    .in(
      "post_id",
      posts.map((post) => post.post_id),
    )
    .eq("status", "ready")
    .order("position");
  if (error) return posts.map((post) => ({ ...post, attachments: [] }));
  const urls = await createPostAttachmentUrls(
    (data ?? []).map((item) => item.object_path),
  );
  return posts.map((post) => ({
    ...post,
    attachments: (data ?? [])
      .filter((item) => item.post_id === post.post_id)
      .map((item) => ({
        ...item,
        attachment_id: item.id,
        signedUrl: urls.get(item.object_path) ?? null,
      })),
  }));
}

export async function listPostAttachments(
  postId: string,
): Promise<PostAttachment[]> {
  const { data, error } = await getSupabase().rpc("list_post_attachments", {
    p_post_id: postId,
  });
  if (error) throw error;
  const rows = data ?? [];
  const urls = await createPostAttachmentUrls(
    rows.map((item) => item.object_path),
  );
  return rows.map((item) => ({
    ...item,
    signedUrl: urls.get(item.object_path) ?? null,
  }));
}

export async function listGroupCategories(
  groupId: string,
): Promise<GroupCategory[]> {
  const { data, error } = await getSupabase()
    .from("group_categories")
    .select("*")
    .eq("group_id", groupId)
    .order("position")
    .order("created_at");
  if (error) throw error;
  return data;
}

export async function listGroupPosts(
  groupId: string,
  options: { categoryId?: string | null; cursor?: PostCursor | null } = {},
): Promise<GroupPostPage> {
  const { data, error } = await getSupabase().rpc("list_group_posts", {
    p_group_id: groupId,
    p_category_id: options.categoryId ?? undefined,
    p_cursor_published_at: options.cursor?.publishedAt,
    p_cursor_post_id: options.cursor?.postId,
    p_limit: GROUP_POST_PAGE_SIZE + 1,
  });
  if (error) throw error;
  const rows = data ?? [];
  const posts = await attachFiles(rows.slice(0, GROUP_POST_PAGE_SIZE));
  const last = posts.at(-1);
  return {
    posts,
    nextCursor:
      rows.length > GROUP_POST_PAGE_SIZE && last
        ? { publishedAt: last.published_at, postId: last.post_id }
        : null,
  };
}

export async function searchGroupPosts(
  groupId: string,
  query: string,
): Promise<GroupPost[]> {
  const normalized = query.normalize("NFC").trim();
  if (!normalized) return [];
  const { data, error } = await getSupabase().rpc("search_group_posts", {
    p_group_id: groupId,
    p_query: normalized,
    p_limit: 50,
  });
  if (error) throw error;
  return attachFiles(data ?? []);
}

export async function getGroupPost(
  postId: string,
): Promise<GroupPostDetail | null> {
  const { data, error } = await getSupabase().rpc("get_group_post", {
    p_post_id: postId,
  });
  if (error) throw error;
  const post = data?.[0];
  if (!post) return null;
  return { ...post, attachments: await listPostAttachments(postId) };
}
