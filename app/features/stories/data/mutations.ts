import type { PostReaction } from "~/features/posts/model/types";
import type {
  StoryBackground,
  StoryLayout,
} from "~/features/stories/model/story";
import { getSupabase } from "~/shared/supabase/client";
import type { Json } from "~/shared/supabase/database.types";

export async function createTextStory(input: {
  content: string;
  background: StoryBackground;
  linkUrl: string | null;
  layout: StoryLayout | null;
}): Promise<void> {
  const { error } = await getSupabase().rpc("create_text_story", {
    p_content: input.content,
    p_background: input.background,
    p_link_url: input.linkUrl ?? undefined,
    p_layout: (input.layout ?? undefined) as Json | undefined,
  });

  if (error) throw error;
}

export async function deleteMyStory(storyId: number): Promise<void> {
  const { error } = await getSupabase().rpc("delete_my_story", {
    p_story_id: storyId,
  });

  if (error) throw error;
}

/** 다른 사람의 스토리를 봤다고 남긴다. 작성자 본인이면 DB가 무시한다. */
export async function markStoryViewed(storyId: number): Promise<void> {
  const { error } = await getSupabase().rpc("mark_story_viewed", {
    p_story_id: storyId,
  });

  if (error) throw error;
}

/** 반응은 누를 때마다 하나씩 쌓인다. 한 스토리에 보낼 수 있는 수를 넘으면 `54000`을 던진다. */
export async function sendStoryReaction(
  storyId: number,
  reaction: PostReaction,
): Promise<void> {
  const { error } = await getSupabase().rpc("send_story_reaction", {
    p_story_id: storyId,
    p_reaction: reaction,
  });

  if (error) throw error;
}

/** 올려 둘 수 있는 스토리 수나 한 스토리에 보낼 반응 수를 넘었을 때 DB가 던지는 코드. */
export function isStoryLimitError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "54000"
  );
}
