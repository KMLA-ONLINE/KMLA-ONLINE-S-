import { createSignedUrls } from "~/shared/supabase/signed-urls";
import { STORAGE_UPLOAD_CACHE_CONTROL } from "~/shared/supabase/storage";
import { getSupabase } from "~/shared/supabase/client";

const BUCKET = "group-media";

export async function uploadGroupMedia(
  path: string,
  file: File,
): Promise<void> {
  const { error } = await getSupabase()
    .storage.from(BUCKET)
    .upload(path, file, {
      contentType: "image/webp",
      cacheControl: STORAGE_UPLOAD_CACHE_CONTROL,
      upsert: false,
    });
  if (error) throw error;
}

export function createGroupMediaUrls(
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  return createSignedUrls(BUCKET, paths);
}
