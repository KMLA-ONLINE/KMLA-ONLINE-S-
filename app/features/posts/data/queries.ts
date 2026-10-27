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
  PostPreview,
  PostReactor,
  ProfilePost,
  ProfilePostCursor,
  ProfilePostPage,
} from "~/features/posts/model/types";
import type { PostAttachment } from "~/features/posts/model/types";
import { createPostAttachmentUrls } from "~/features/posts/data/files";
import {
  applyAttachmentUrls,
  attachmentPaths,
  readAttachmentsJson,
  readCommentImagesJson,
} from "~/features/posts/model/attachment-json";
import { createProfileMediaUrls } from "~/features/profiles/data/media";
import { getSupabase } from "~/shared/supabase/client";
import type { Json } from "~/shared/supabase/database.types";

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

type UnhydratedComment = Omit<PostComment, "images" | "author_avatar_url"> & {
  /** 목록 RPC가 함께 내려준 이미지. 없으면(작성·수정 응답) `list_comment_images`로 따로 읽는다. */
  images?: Json;
};

async function readCommentImages(
  comments: UnhydratedComment[],
): Promise<CommentImage[]> {
  if (comments.every((comment) => comment.images !== undefined)) {
    return comments.flatMap((comment) =>
      readCommentImagesJson(comment.images, comment),
    );
  }
  const { data, error } = await getSupabase().rpc("list_comment_images", {
    p_comment_ids: comments.map((comment) => comment.comment_id),
  });
  if (error) throw error;
  return (data ?? []).map((image) => ({ ...image, signedUrl: null }));
}

/** 댓글 한 묶음에 이미지와 작성자 아바타를 채운다. 두 버킷은 병렬로 서명하고 아바타는 `author_avatar_url`에만 채운다. */
export async function hydratePostComments(
  comments: UnhydratedComment[],
): Promise<PostComment[]> {
  if (comments.length === 0) return [];
  const images = await readCommentImages(comments);
  const [urls, avatarUrls] = await Promise.all([
    createPostAttachmentUrls(images.map((image) => image.object_path)),
    createProfileMediaUrls(
      comments.map((comment) => comment.author_avatar_path),
    ),
  ]);
  return comments.map((comment) => ({
    ...comment,
    author_avatar_url: comment.author_avatar_path
      ? (avatarUrls.get(comment.author_avatar_path) ?? null)
      : null,
    images: images
      .filter((image) => image.comment_id === comment.comment_id)
      .map((image) => ({
        ...image,
        signedUrl: urls.get(image.object_path) ?? null,
      })),
  }));
}

interface ProfileMediaPaths {
  activity_media_path: string | null;
  author_avatar_path: string | null;
}

function profileMediaPaths(posts: readonly ProfileMediaPaths[]) {
  return posts.flatMap((post) => [
    post.author_avatar_path,
    post.activity_media_path,
  ]);
}

/** 결과는 `*_url`에만 담는다. 경로를 덮어쓰지 않으므로 다시 통과시켜도 같다(멱등). */
function applyProfileMediaUrls<T extends ProfileMediaPaths>(
  post: T,
  urls: Map<string, string>,
): T & { activity_media_url: string | null; author_avatar_url: string | null } {
  return {
    ...post,
    author_avatar_url: post.author_avatar_path
      ? (urls.get(post.author_avatar_path) ?? null)
      : null,
    activity_media_url: post.activity_media_path
      ? (urls.get(post.activity_media_path) ?? null)
      : null,
  };
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
  // 첨부는 목록 RPC가 같이 내려준다. 서명은 아래에서 아바타와 함께 한 번에 한다.
  const postsWithFiles = rows.slice(0, GROUP_POST_PAGE_SIZE).map((row) => ({
    ...row,
    attachments: readAttachmentsJson(row.attachments, row.post_id),
  }));
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
 * 대표 게시물(기능 명세 §8.18). 그룹당 10개가 상한이라 커서가 없고, 카테고리 필터와 무관하다.
 * 카드로만 그리므로 보기 방식과 관계없이 항상 서명한다.
 */
export async function listGroupFeaturedPosts(
  groupId: string,
): Promise<GroupPost[]> {
  const { data, error } = await getSupabase().rpc("list_group_featured_posts", {
    p_group_id: groupId,
  });
  if (error) throw error;
  return hydrateGroupPostMedia(
    (data ?? []).map(withMentions).map((row) => ({
      ...row,
      attachments: readAttachmentsJson(row.attachments, row.post_id),
    })),
  );
}

/** 그룹 게시물 묶음에 첨부와 아바타의 signed URL을 채운다. 멱등하다 — 경로를 덮어쓰면 로더가 채운 첫 페이지를 다시 통과시킬 때 서명이 실패해 아바타가 사라진다. */
export async function hydrateGroupPostMedia(
  posts: Omit<GroupPost, "author_avatar_url">[],
): Promise<GroupPostPage["posts"]> {
  const [attachmentUrls, profileUrls] = await Promise.all([
    createPostAttachmentUrls(
      attachmentPaths(posts.flatMap((post) => post.attachments)),
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
    attachments: applyAttachmentUrls(post.attachments, attachmentUrls),
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

/**
 * 첨부 목록은 게시물 RPC의 결과가 필요 없으므로 같이 띄운다. 기다렸다 부르면 상세를 열 때마다 왕복 하나가 더 붙는다.
 * 게시물이 없으면 첨부 쪽 실패는 의미가 없으니 버린다 — 읽을 수 없는 글의 첨부 RPC는 거절될 수 있다.
 */
function startPostAttachments(postId: string): Promise<PostAttachment[]> {
  const attachments = listPostAttachments(postId);
  attachments.catch(() => undefined);
  return attachments;
}

export async function getGroupPost(
  postId: string,
): Promise<GroupPostDetail | null> {
  const attachments = startPostAttachments(postId);
  const { data, error } = await getSupabase().rpc("get_group_post", {
    p_post_id: postId,
  });
  if (error) throw error;
  const post = data?.[0];
  if (!post) return null;
  const [hydrated] = await hydrateGroupPostMedia([
    { ...withMentions(post), attachments: await attachments },
  ]);
  return hydrated;
}

/** 프로필 타임라인 한 페이지. 한 건을 더 받아 다음 커서를 정하며, 고정이 없어 커서는 `(published_at, post_id)`면 충분하다. */
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
  // 첨부는 목록 RPC가 같이 내려준다. 첨부와 아바타·프로필 미디어는 버킷이 달라 따로 서명하므로
  // 나란히 띄운다. 하나씩 기다리면 타임라인을 열 때마다 서명 왕복이 하나 더 쌓인다.
  const pagePosts = rows.slice(0, PROFILE_POST_PAGE_SIZE).map((row) => ({
    ...row,
    attachments: readAttachmentsJson(row.attachments, row.post_id),
  }));
  const [attachmentUrls, mediaUrls] = await Promise.all([
    createPostAttachmentUrls(
      attachmentPaths(pagePosts.flatMap((post) => post.attachments)),
    ),
    createProfileMediaUrls(profileMediaPaths(pagePosts)),
  ]);
  const posts = pagePosts.map((post) =>
    applyProfileMediaUrls(
      {
        ...post,
        attachments: applyAttachmentUrls(post.attachments, attachmentUrls),
      },
      mediaUrls,
    ),
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
  const attachments = startPostAttachments(postId);
  const { data, error } = await getSupabase().rpc("get_profile_post", {
    p_post_id: postId,
  });
  if (error) throw error;
  const post = data?.[0];
  if (!post) return null;
  const mediaUrls = await createProfileMediaUrls(profileMediaPaths([post]));
  return applyProfileMediaUrls(
    { ...post, attachments: await attachments },
    mediaUrls,
  );
}

/** 최상위 댓글 한 페이지. 한 건을 더 받아 다음 페이지 유무를 확인하고 마지막 댓글을 커서로 쓴다. */
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

/** 반응 참여자 목록. 요약을 누를 때만 부른다. */
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

/** 멘션 후보 한 페이지(기능 명세 §8.14). 정렬은 RPC가 정하고(선생님 먼저, 최근 기수순), 찾는 화면이라 커서 대신 검색어로 좁힌다. */
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

/** 한 번에 묻는 게시물 수. 서버 `list_post_previews`가 같은 상한을 강제한다. */
const POST_PREVIEW_BATCH_SIZE = 100;

/**
 * 메시지 안 게시물 카드(기능 명세 §13.21). 읽을 수 없는 게시물은 결과에서 빠지므로 `null`로 채워
 * 돌려준다. RPC 실패는 그대로 던져 카드가 `null`(볼 수 없음)이 아닌 오류로 그리게 한다. 사진과
 * 아바타는 버킷이 달라 나란히 서명한다.
 */
export async function listPostPreviews(
  postIds: readonly string[],
): Promise<Map<string, PostPreview | null>> {
  const rows = (
    await Promise.all(
      chunk(postIds, POST_PREVIEW_BATCH_SIZE).map(async (ids) => {
        const { data, error } = await getSupabase().rpc("list_post_previews", {
          p_post_ids: ids,
        });
        if (error) throw error;
        return data ?? [];
      }),
    )
  ).flat();
  // 서명 실패는 사진만 잃는다. 카드 글자까지 버리면 읽을 수 있는 게시물이 실패 카드로 바뀐다.
  const [imageUrls, avatarUrls] = await Promise.all([
    createPostAttachmentUrls(rows.map((row) => row.image_path)).catch(
      () => new Map<string, string>(),
    ),
    createProfileMediaUrls(
      rows.flatMap((row) => [row.author_avatar_path, row.activity_media_path]),
    ).catch(() => new Map<string, string>()),
  ]);
  const previews = new Map<string, PostPreview | null>(
    postIds.map((id) => [id, null]),
  );
  for (const row of rows) {
    previews.set(row.post_id, {
      postId: row.post_id,
      kind: row.kind,
      groupName: row.group_name,
      title: row.title,
      body: row.body,
      authorIdentity: row.author_identity,
      authorName: row.author_name,
      authorLabel: row.author_label,
      authorAvatarUrl: row.author_avatar_path
        ? (avatarUrls.get(row.author_avatar_path) ?? null)
        : null,
      // 프로필 사진·커버 변경 활동의 사진은 첨부가 아니라 profile-media 버킷에 있다.
      imageUrl: row.image_path
        ? (imageUrls.get(row.image_path) ?? null)
        : row.activity_media_path
          ? (avatarUrls.get(row.activity_media_path) ?? null)
          : null,
      activityKind: row.activity_kind,
    });
  }
  return previews;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
