import type { StoryBackground } from "~/features/stories/model/story";
import { getSupabase } from "~/shared/supabase/client";

export async function createTextStory(input: {
  content: string;
  background: StoryBackground;
  linkUrl: string | null;
}): Promise<void> {
  const { error } = await getSupabase().rpc("create_text_story", {
    p_content: input.content,
    p_background: input.background,
    p_link_url: input.linkUrl ?? undefined,
  });

  if (error) throw error;
}

export async function deleteMyStory(storyId: number): Promise<void> {
  const { error } = await getSupabase().rpc("delete_my_story", {
    p_story_id: storyId,
  });

  if (error) throw error;
}

/** 24시간 안에 올려 둘 수 있는 수를 넘었을 때 DB가 던지는 코드. */
export function isStoryLimitError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "54000"
  );
}
