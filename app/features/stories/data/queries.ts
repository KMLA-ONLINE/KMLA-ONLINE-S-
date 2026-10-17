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
    publishedAt: row.published_at,
  }));
}
