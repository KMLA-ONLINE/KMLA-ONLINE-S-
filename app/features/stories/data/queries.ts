import { createProfileMediaUrls } from "~/features/profiles/data/media";
import { createStoryMediaUrls } from "~/features/stories/data/files";
import {
  isStoryBackground,
  type StoryBackground,
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
  publishedAt: string;
}

/**
 * 레일은 작성자마다 가장 최근 스토리의 축소본 하나만 그리므로 그것만 서명한다. 원본은 뷰어가
 * 그 장을 열 때 서명한다. signed URL은 경로별로 캐시되므로(`createSignedUrls`) 같은 URL이
 * 유지되는 동안 브라우저 HTTP 캐시가 그대로 맞는다.
 */
export async function listActiveStories(): Promise<StoryItem[]> {
  const { data, error } = await getSupabase().rpc("list_active_stories");

  if (error) throw error;

  const rows = data ?? [];
  // 목록은 작성자 안에서 올린 순서다. 작성자가 바뀌기 직전 행이 그 작성자의 커버다.
  const coverThumbnails = rows
    .filter((row, index) => rows[index + 1]?.pub_id !== row.pub_id)
    .map((row) => row.thumbnail_path);
  const [avatarUrls, thumbnailUrls] = await Promise.all([
    createProfileMediaUrls(rows.map((row) => row.avatar_path)),
    createStoryMediaUrls(coverThumbnails),
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
    publishedAt: row.published_at,
  }));
}
