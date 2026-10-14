import type { FeedPost } from "~/features/feed/model/types";
import { splitPostAttachments } from "~/features/posts/model/attachments";

/** 한 번의 서명 요청에 넘기는 버킷별 경로. 쿼리 키에도 그대로 들어가므로 순서가 안정적이어야 한다. */
export interface FeedMediaPaths {
  attachments: string[];
  profiles: string[];
}

/** 경로 → signed URL. 서명에 실패한 경로는 빠진다. */
export interface FeedMediaUrls {
  attachments: Record<string, string>;
  profiles: Record<string, string>;
}

function unique(paths: (string | null)[]): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}

export function feedMediaPaths(posts: readonly FeedPost[]): FeedMediaPaths {
  return {
    attachments: unique(
      posts.flatMap((post) =>
        post.attachments.flatMap((item) => [
          item.object_path,
          item.thumbnail_path,
        ]),
      ),
    ),
    profiles: unique(
      posts.flatMap((post) => [
        post.author_avatar_path,
        post.activity_media_path,
      ]),
    ),
  };
}

/**
 * 경로로 URL을 찾아 비어 있는 URL 필드만 채운다. 경로가 바뀐 미디어는 옛 URL을 집지 못하고,
 * 본문·반응 같은 나머지 필드는 목록 쿼리의 최신 값이 그대로 남는다. 채울 게 없으면 같은 객체를 돌려준다.
 */
export function applyFeedMediaUrls(
  post: FeedPost,
  urls: FeedMediaUrls,
): FeedPost {
  let changed = false;
  const lookup = (
    current: string | null,
    path: string | null,
    table: Record<string, string>,
  ) => {
    if (current || !path) return current;
    const url = table[path] ?? null;
    if (url) changed = true;
    return url;
  };

  const author_avatar_url = lookup(
    post.author_avatar_url,
    post.author_avatar_path,
    urls.profiles,
  );
  const attachments = post.attachments.map((attachment) => {
    const signedUrl = lookup(
      attachment.signedUrl,
      attachment.object_path,
      urls.attachments,
    );
    const thumbnailUrl = lookup(
      attachment.thumbnailUrl,
      attachment.thumbnail_path,
      urls.attachments,
    );
    return signedUrl === attachment.signedUrl &&
      thumbnailUrl === attachment.thumbnailUrl
      ? attachment
      : { ...attachment, signedUrl, thumbnailUrl };
  });

  if (post.kind === "group") {
    return changed ? { ...post, author_avatar_url, attachments } : post;
  }
  const activity_media_url = lookup(
    post.activity_media_url,
    post.activity_media_path,
    urls.profiles,
  );
  return changed
    ? { ...post, author_avatar_url, attachments, activity_media_url }
    : post;
}

/** 아직 URL이 없는 미디어가 있는지. 아바타는 대체 이미지가 있어 로딩 표시 대상에서 뺀다. */
export function hasMissingMedia(post: FeedPost): boolean {
  return (
    Boolean(post.activity_media_path && !post.activity_media_url) ||
    post.attachments.some((item) => !item.signedUrl)
  );
}

/** '이미지 다시 불러오기'가 다시 요청할 경로. 버튼 이름에 맞춰 이미지와 활동 사진만 센다. */
export function missingImagePaths(post: FeedPost): string[] {
  return [
    ...(post.activity_media_path && !post.activity_media_url
      ? [post.activity_media_path]
      : []),
    ...splitPostAttachments(post.attachments)
      .images.filter((item) => !item.signedUrl)
      .map((item) => item.object_path),
  ];
}
