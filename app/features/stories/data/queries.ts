import { createProfileMediaUrls } from "~/features/profiles/data/media";
import { getSupabase } from "~/shared/supabase/client";

export interface StoryItem {
  pubId: string;
  name: string;
  avatarUrl: string | null;
  content: string;
}

export async function listTodayStories(): Promise<StoryItem[]> {
  const { data, error } = await getSupabase().rpc("list_today_stories");

  if (error) throw error;

  const rows = data ?? [];
  const mediaUrls = await createProfileMediaUrls(
    rows.map((row) => row.avatar_path),
  );

  return rows.map((row) => ({
    pubId: row.pub_id,
    name: row.name,
    avatarUrl: row.avatar_path
      ? (mediaUrls.get(row.avatar_path) ?? null)
      : null,
    content: row.content,
  }));
}
