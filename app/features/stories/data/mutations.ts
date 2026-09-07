import { getSupabase } from "~/shared/supabase/client";

export async function setMyStory(content: string): Promise<void> {
  const { error } = await getSupabase().rpc("set_my_story", {
    p_content: content,
  });

  if (error) throw error;
}

export async function deleteMyStory(): Promise<void> {
  const { error } = await getSupabase().rpc("delete_my_story");

  if (error) throw error;
}
