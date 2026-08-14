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

export async function createPostAttachmentUrls(
  paths: string[],
): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data, error } = await getSupabase()
    .storage.from(BUCKET)
    .createSignedUrls(paths, 3600);
  if (error) return new Map();
  return new Map(
    (data ?? []).flatMap((item) =>
      item.signedUrl && item.path ? [[item.path, item.signedUrl] as const] : [],
    ),
  );
}
