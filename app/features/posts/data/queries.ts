import {
  withMentions,
  type MentionCandidate,
} from "~/features/posts/model/mentions";
import type {
  CommentCursor,
  CommentImage,
  GroupCategory,
  GroupPost,
  GroupPostDetail,
  GroupPostPage,
  GroupPostSearchResult,
  AnonymousActivityRestriction,
  PostComment,
  PostCommentPage,
  PostCursor,
  PostReactor,
  ProfilePost,
  ProfilePostCursor,
  ProfilePostPage,
} from "~/features/posts/model/types";
import type { PostAttachment } from "~/features/posts/model/types";
import { createPostAttachmentUrls } from "~/features/posts/data/files";
import { createProfileMediaUrls } from "~/features/profiles/data/media";
import { getSupabase } from "~/shared/supabase/client";

const GROUP_POST_PAGE_SIZE = 12;
const PROFILE_POST_PAGE_SIZE = 12;
const POST_COMMENT_PAGE_SIZE = 20;

export async function getMyGroupAnonymousActivityRestriction(
  groupId: string,
): Promise<AnonymousActivityRestriction | null> {
  const { data, error } = await getSupabase().rpc(
    "get_my_group_anonymous_activity_restriction",
    { p_group_id: groupId },
  );
  if (error) throw error;
  return data?.[0] ?? null;
}

/**
 * 댓글 한 묶음에 이미지와 작성자 아바타를 채운다.
 *
 * 두 버킷을 병렬로 서명한다 — 이미지 목록 RPC와 아바타 서명은 서로를 기다릴 이유가 없다.
 * 아바타는 `author_avatar_url`에만 채우고 원시 경로는 그대로 둔다(모델 타입 주석 참고).
 */
export async function hydratePostComments(
  comments: Omit<PostComment, "images" | "author_avatar_url">[],
): Promise<PostComment[]> {
  if (comments.length === 0) return [];
  const { data, error } = await getSupabase().rpc("list_comment_images", {
    p_comment_ids: comments.map((comment) => comment.comment_id),
  });
  if (error) throw error;
  const rows = data ?? [];
  const [urls, avatarUrls] = await Promise.all([
    createPostAttachmentUrls(rows.map((image) => image.object_path)),
    createProfileMediaUrls(
      comments.map((comment) => comment.author_avatar_path),
    ),
  ]);
  return comments.map((comment) => ({
    ...comment,
    author_avatar_url: comment.author_avatar_path
      ? (avatarUrls.get(comment.author_avatar_path) ?? null)
      : null,
    images: rows
      .filter((image) => image.comment_id === comment.comment_id)
      .map((image): CommentImage => ({
        ...image,
        signedUrl: urls.get(image.object_path) ?? null,
      })),
  }));
}

async function attachFiles<T extends { post_id: string }>(
  posts: T[],
  signUrls = true,
): Promise<(T & { attachments: PostAttachment[] })[]> {
  if (posts.length === 0) return [];
  const { data, error } = await getSupabase()
    .from("post_attachments")
    .select(
      "id,post_id,storage_bucket,object_path,thumbnail_path,original_filename,position,mime_type,size_bytes,width,height",
    )
    .in(
      "post_id",
      posts.map((post) => post.post_id),
    )
    .eq("status", "ready")
    .order("position");
  if (error) throw error;
  // 원본과 축소본을 한 번에 서명한다. 경로를 나눠 두 번 부르면 배치가 갈라져 왕복이 는다.
  const urls = signUrls
    ? await createPostAttachmentUrls(
        (data ?? []).flatMap((item) => [item.object_path, item.thumbnail_path]),
      )
    : new Map<string, string>();
  return posts.map((post) => ({
    ...post,
    attachments: (data ?? [])
      .filter((item) => item.post_id === post.post_id)
      .map((item) => ({
        attachment_id: item.id,
        post_id: item.post_id,
        storage_bucket: item.storage_bucket,
        object_path: item.object_path,
        original_filename: item.original_filename,
        position: item.position,
        mime_type: item.mime_type,
        size_bytes: item.size_bytes,
        width: item.width,
        height: item.height,
        signedUrl: urls.get(item.object_path) ?? null,
        thumbnail_path: item.thumbnail_path,
        thumbnailUrl: item.thumbnail_path
          ? (urls.get(item.thumbnail_path) ?? null)
          : null,
      })),
  }));
}

/**
 * 아바타와 프로필 미디어 활동 이미지를 한 번에 서명한다.
 *
 * 서명 결과는 언제나 `*_url`에 담고 원시 경로는 건드리지 않는다. 그래야 이미 채워진 목록을
 * 다시 통과시켜도 같은 결과가 나온다(모델 타입 주석 참고).
 */
async function attachProfileMedia<
  T extends {
    activity_media_path: string | null;
    author_avatar_path: string | null;
  },
>(
  posts: T[],
): Promise<
  (T & {
    activity_media_url: string | null;
    author_avatar_url: string | null;
  })[]
> {
  const urls = await createProfileMediaUrls(
    posts.flatMap((post) => [
      post.author_avatar_path,
      post.activity_media_path,
    ]),
  );

  return posts.map((post) => ({
    ...post,
    author_avatar_url: post.author_avatar_path
      ? (urls.get(post.author_avatar_path) ?? null)
      : null,
    activity_media_url: post.activity_media_path
      ? (urls.get(post.activity_media_path) ?? null)
      : null,
  }));
}

async function listPostAttachments(postId: string): Promise<PostAttachment[]> {
  const { data, error } = await getSupabase().rpc("list_post_attachments", {
    p_post_id: postId,
  });
  if (error) throw error;
  const rows = data ?? [];
  const urls = await createPostAttachmentUrls(
    rows.flatMap((item) => [item.object_path, item.thumbnail_path]),
  );
  return rows.map((item) => ({
    attachment_id: item.attachment_id,
    post_id: item.post_id,
    storage_bucket: item.storage_bucket,
    object_path: item.object_path,
    original_filename: item.original_filename,
    position: item.position,
    mime_type: item.mime_type,
    size_bytes: item.size_bytes,
    width: item.width ?? null,
    height: item.height ?? null,
    signedUrl: urls.get(item.object_path) ?? null,
    thumbnail_path: item.thumbnail_path,
    thumbnailUrl: item.thumbnail_path
      ? (urls.get(item.thumbnail_path) ?? null)
      : null,
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
  options: {
    categoryId?: string | null;
    cursor?: PostCursor | null;
    hydrateMedia?: boolean;
  } = {},
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
  const rows = (data ?? []).map(withMentions);
  const postsWithFiles = await attachFiles(
    rows.slice(0, GROUP_POST_PAGE_SIZE),
    false,
  );
  const posts =
    options.hydrateMedia === false
      ? // 목록 보기는 아바타도 첨부도 그리지 않는다. 서명은 카드 보기로 바꿀 때
        // `hydrateGroupPostMedia()`가 마저 채운다.
        postsWithFiles.map((post) => ({ ...post, author_avatar_url: null }))
      : await hydrateGroupPostMedia(postsWithFiles);
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

/**
 * 그룹 게시물 묶음에 첨부와 아바타의 signed URL을 채운다.
 *
 * 멱등하다 — 서명 결과는 `*_url`/`signedUrl`에만 담고 경로 컬럼은 건드리지 않는다. 로더가
 * 이미 채워 둔 첫 페이지를 화면의 효과가 한 번 더 통과시키므로, 여기서 경로를 덮어쓰면
 * 두 번째 통과에서 서명이 실패해 아바타가 전부 사라진다.
 */
export async function hydrateGroupPostMedia(
  posts: Omit<GroupPost, "author_avatar_url">[],
): Promise<GroupPostPage["posts"]> {
  const [attachmentUrls, profileUrls] = await Promise.all([
    createPostAttachmentUrls(
      posts.flatMap((post) =>
        post.attachments.flatMap((attachment) => [
          attachment.object_path,
          attachment.thumbnail_path,
        ]),
      ),
    ),
    createProfileMediaUrls(posts.map((post) => post.author_avatar_path)),
  ]);

  return posts.map((post) => ({
    ...post,
    // 서명에 실패하면 null이다. 화면이 원시 object path를 그리면 <img src>가 상대 경로로
    // 나가 깨진 이미지가 되고, null이어야 기본 실루엣으로 떨어진다.
    author_avatar_url: post.author_avatar_path
      ? (profileUrls.get(post.author_avatar_path) ?? null)
      : null,
    attachments: post.attachments.map((attachment) => ({
      ...attachment,
      signedUrl: attachmentUrls.get(attachment.object_path) ?? null,
      thumbnailUrl: attachment.thumbnail_path
        ? (attachmentUrls.get(attachment.thumbnail_path) ?? null)
        : null,
    })),
  }));
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
  const [hydrated] = await hydrateGroupPostMedia([
    { ...withMentions(post), attachments: await listPostAttachments(postId) },
  ]);
  return hydrated;
}

/**
 * 프로필 타임라인 한 페이지.
 *
 * 그룹 목록과 같은 방식으로 한 건을 더 받아 다음 커서를 정한다. 고정 게시물이 없으므로
 * 커서는 `(published_at, post_id)` 두 값이면 충분하다.
 *
 * 타임라인을 화면과 같은 공개 ID로 가리키므로 loader가 프로필 조회를 기다리지 않는다 —
 * 프로필과 타임라인이 나란히 나간다.
 */
export async function listProfilePosts(
  timelinePubId: string,
  cursor?: ProfilePostCursor | null,
): Promise<ProfilePostPage> {
  const { data, error } = await getSupabase().rpc("list_profile_posts", {
    p_timeline_pub_id: timelinePubId,
    p_cursor_published_at: cursor?.publishedAt,
    p_cursor_post_id: cursor?.postId,
    p_limit: PROFILE_POST_PAGE_SIZE + 1,
  });
  if (error) throw error;
  const rows = data ?? [];
  const posts = await attachProfileMedia(
    await attachFiles(rows.slice(0, PROFILE_POST_PAGE_SIZE)),
  );
  const last = posts.at(-1);
  return {
    posts,
    nextCursor:
      rows.length > PROFILE_POST_PAGE_SIZE && last
        ? { publishedAt: last.published_at, postId: last.post_id }
        : null,
  };
}

export async function getProfilePost(
  postId: string,
): Promise<ProfilePost | null> {
  const { data, error } = await getSupabase().rpc("get_profile_post", {
    p_post_id: postId,
  });
  if (error) throw error;
  const post = data?.[0];
  if (!post) return null;
  const [hydrated] = await attachProfileMedia([
    { ...post, attachments: await listPostAttachments(postId) },
  ]);
  return hydrated;
}

/**
 * 최상위 댓글 한 페이지.
 *
 * RPC는 오래된 댓글부터 화면 순서대로 돌려준다. 한 건을 더 받아 다음 페이지가 있는지만 확인하고,
 * 현재 페이지의 마지막 댓글을 다음 커서로 쓴다.
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
  const rows = (data ?? []).map(withMentions);
  const hasMore = rows.length > POST_COMMENT_PAGE_SIZE;
  const comments = await hydratePostComments(
    hasMore ? rows.slice(0, POST_COMMENT_PAGE_SIZE) : rows,
  );
  const newest = comments.at(-1);
  return {
    comments,
    nextCursor:
      hasMore && newest
        ? { createdAt: newest.created_at, commentId: newest.comment_id }
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
  return hydratePostComments((data ?? []).map(withMentions));
}

/**
 * 반응 참여자 목록. 요약을 누를 때만 부른다 — 목록 화면에서 게시물마다
 * 미리 받으면 반응 하나 보자고 페이지 전체가 무거워진다.
 */
export async function listPostReactors(postId: string): Promise<PostReactor[]> {
  const { data, error } = await getSupabase().rpc("list_post_reactors", {
    p_post_id: postId,
  });
  if (error) throw error;
  return signReactorAvatars(data ?? []);
}

/** 댓글 반응 참여자 목록. 게시물과 같은 모양이라 같은 dialog가 받는다. */
export async function listCommentReactors(
  commentId: string,
): Promise<PostReactor[]> {
  const { data, error } = await getSupabase().rpc("list_comment_reactors", {
    p_comment_id: commentId,
  });
  if (error) throw error;
  return signReactorAvatars(data ?? []);
}

/** 두 반응자 목록이 같은 모양이라 서명도 한 곳에서 한다. */
async function signReactorAvatars(
  rows: Omit<PostReactor, "reactor_avatar_url">[],
): Promise<PostReactor[]> {
  const urls = await createProfileMediaUrls(
    rows.map((row) => row.reactor_avatar_path),
  );
  return rows.map((row) => ({
    ...row,
    reactor_avatar_url: row.reactor_avatar_path
      ? (urls.get(row.reactor_avatar_path) ?? null)
      : null,
  }));
}

/**
 * 멘션 후보 한 페이지(기능 명세 §8.14).
 *
 * 정렬은 RPC가 정한다 — 선생님이 먼저, 그다음 최근 기수부터다. 명부(`list_group_members`)와
 * 순서가 다르므로 그쪽을 재사용하지 않는다. 커서를 두지 않는 것은 부를 사람을 찾는 화면이기
 * 때문이다. 목록을 끝까지 훑는 대신 검색어로 좁힌다.
 */
export async function searchGroupMentionCandidates(
  groupId: string,
  query = "",
): Promise<MentionCandidate[]> {
  const { data, error } = await getSupabase().rpc(
    "search_group_mention_candidates",
    { p_group_id: groupId, p_query: query, p_limit: 30 },
  );
  if (error) throw error;
  const rows = data ?? [];
  const urls = await createProfileMediaUrls(rows.map((row) => row.avatar_path));
  return rows.map((row) => ({
    ...row,
    cohort: row.cohort ?? null,
    avatar_url: row.avatar_path ? (urls.get(row.avatar_path) ?? null) : null,
  }));
}
