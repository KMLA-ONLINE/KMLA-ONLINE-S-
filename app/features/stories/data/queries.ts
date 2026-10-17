import type { PostReaction } from "~/features/posts/model/types";
import { createProfileMediaUrls } from "~/features/profiles/data/media";
import { createStoryMediaUrls } from "~/features/stories/data/files";
import {
  isStoryBackground,
  parseStoryLayout,
  type StoryBackground,
  type StoryLayout,
} from "~/features/stories/model/story";
import { getSupabase } from "~/shared/supabase/client";

export interface StoryItem {
  id: number;
  pubId: string;
  name: string;
  avatarUrl: string | null;
  content: string;
  /** 글 스토리면 배경, 사진 스토리면 `null`. */
  background: StoryBackground | null;
  /** 원본 경로. URL은 뷰어가 그 장을 열 때 `createStoryMediaUrls`로 서명한다. */
  imagePath: string | null;
  /** 레일 카드용 축소본. 글 스토리는 `null`. */
  thumbnailUrl: string | null;
  linkUrl: string | null;
  /** 글과 링크를 놓은 자리. 위치 편집 전에 올린 스토리는 `null`이라 기본 자리에 그린다. */
  layout: StoryLayout | null;
  publishedAt: string;
}

/**
 * 레일 카드는 그 작성자의 장을 차례로 돌려 보여 주므로 축소본을 모두 서명한다. 원본은 뷰어가
 * 그 장을 열 때 서명한다. signed URL은 경로별로 캐시되므로(`createSignedUrls`) 같은 URL이
 * 유지되는 동안 브라우저 HTTP 캐시가 그대로 맞는다.
 */
export async function listActiveStories(): Promise<StoryItem[]> {
  const { data, error } = await getSupabase().rpc("list_active_stories");

  if (error) throw error;

  const rows = data ?? [];
  const [avatarUrls, thumbnailUrls] = await Promise.all([
    createProfileMediaUrls(rows.map((row) => row.avatar_path)),
    createStoryMediaUrls(rows.map((row) => row.thumbnail_path)),
  ]);

  return rows.map((row) => ({
    id: row.story_id,
    pubId: row.pub_id,
    name: row.name,
    avatarUrl: row.avatar_path
      ? (avatarUrls.get(row.avatar_path) ?? null)
      : null,
    content: row.content,
    background: isStoryBackground(row.background) ? row.background : null,
    imagePath: row.image_path,
    thumbnailUrl: row.thumbnail_path
      ? (thumbnailUrls.get(row.thumbnail_path) ?? null)
      : null,
    linkUrl: row.link_url,
    layout: parseStoryLayout(row.layout),
    publishedAt: row.published_at,
  }));
}

export interface StoryViewerEntry {
  pubId: string;
  name: string;
  avatarUrl: string | null;
  viewedAt: string;
  /** 보낸 순서대로. 같은 반응을 여러 번 보냈으면 그만큼 들어 있다. */
  reactions: PostReaction[];
}

/** 작성자만 부를 수 있다. 다른 사람이 부르면 DB가 `42501`을 던진다. */
export async function listStoryViewers(
  storyId: number,
): Promise<StoryViewerEntry[]> {
  const { data, error } = await getSupabase().rpc("list_story_viewers", {
    p_story_id: storyId,
  });

  if (error) throw error;

  const rows = data ?? [];
  const avatarUrls = await createProfileMediaUrls(
    rows.map((row) => row.avatar_path),
  );

  return rows.map((row) => ({
    pubId: row.pub_id,
    name: row.name,
    avatarUrl: row.avatar_path
      ? (avatarUrls.get(row.avatar_path) ?? null)
      : null,
    viewedAt: row.viewed_at,
    reactions: row.reactions,
  }));
}
