import { createSignedUrls } from "~/shared/supabase/signed-urls";
import { getSupabase } from "~/shared/supabase/client";

const BUCKET = "post-attachments";

export async function uploadPostAttachment(
  path: string,
  file: File,
): Promise<void> {
  const { error } = await getSupabase()
    .storage.from(BUCKET)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) throw error;
}

export function createPostAttachmentUrls(
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  return createSignedUrls(BUCKET, paths);
}
