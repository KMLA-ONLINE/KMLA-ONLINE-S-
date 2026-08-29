import { createSignedUrls } from "~/shared/supabase/signed-urls";
import { STORAGE_UPLOAD_CACHE_CONTROL } from "~/shared/supabase/storage";
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
      cacheControl: STORAGE_UPLOAD_CACHE_CONTROL,
      upsert: false,
    });
  if (error) throw error;
}

export function createPostAttachmentUrls(
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  return createSignedUrls(BUCKET, paths);
}
