import type {
  CommentCursor,
  GroupCategory,
  GroupPostDetail,
  GroupPostPage,
  GroupPostSearchResult,
  PostComment,
  PostCommentPage,
  PostCursor,
} from "~/features/posts/model/types";
import type { PostAttachment } from "~/features/posts/model/types";
import { createPostAttachmentUrls } from "~/features/posts/data/files";
import { getSupabase } from "~/shared/supabase/client";

export const GROUP_POST_PAGE_SIZE = 12;
export const POST_COMMENT_PAGE_SIZE = 20;

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
  if (error) throw error;
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
    p_cursor_is_pinned: options.cursor?.isPinned,
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
        ? {
            publishedAt: last.published_at,
            postId: last.post_id,
            isPinned: last.is_pinned,
          }
        : null,
  };
}

export async function searchGroupPosts(
  groupId: string,
  query: string,
): Promise<GroupPostSearchResult[]> {
  const normalized = query.normalize("NFC").trim();
  if (!normalized) return [];
  const { data, error } = await getSupabase().rpc("search_group_posts", {
    p_group_id: groupId,
    p_query: normalized,
    p_limit: 50,
  });
  if (error) throw error;
  return data ?? [];
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

/**
 * 최상위 댓글 한 페이지.
 *
 * RPC는 최신부터 골라 오래된 순으로 돌려준다. 화면은 오래된→최신으로 그리고 "이전 댓글 더
 * 보기"가 위로 붙으므로, 한 건을 더 받아 초과분이 있으면 그 자리가 다음 커서가 된다.
 */
export async function listPostComments(
  postId: string,
  cursor?: CommentCursor | null,
): Promise<PostCommentPage> {
  const { data, error } = await getSupabase().rpc("list_post_comments", {
    p_post_id: postId,
    p_cursor_created_at: cursor?.createdAt,
    p_cursor_comment_id: cursor?.commentId,
    p_limit: POST_COMMENT_PAGE_SIZE + 1,
  });
  if (error) throw error;
  const rows = data ?? [];
  // 초과분은 가장 오래된 한 건이다. 잘라내고 남은 첫 건이 다음에 이어 볼 지점이 된다.
  const hasOlder = rows.length > POST_COMMENT_PAGE_SIZE;
  const comments = hasOlder ? rows.slice(1) : rows;
  const oldest = comments[0];
  return {
    comments,
    olderCursor:
      hasOlder && oldest
        ? { createdAt: oldest.created_at, commentId: oldest.comment_id }
        : null,
  };
}

/** 최상위 댓글 하나의 답글 묶음 전체. 펼칠 때 한 번만 부른다. */
export async function listPostCommentReplies(
  rootCommentId: string,
): Promise<PostComment[]> {
  const { data, error } = await getSupabase().rpc("list_post_comment_replies", {
    p_root_comment_id: rootCommentId,
  });
  if (error) throw error;
  return data ?? [];
}
