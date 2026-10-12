import { createSignedUrls } from "~/shared/supabase/signed-urls";
import { uploadStorageObject } from "~/shared/supabase/upload";

const BUCKET = "post-attachments";
export function uploadPostAttachment(
  path: string,
  file: File,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return uploadStorageObject(BUCKET, path, file, onProgress, signal);
}

export function createPostAttachmentUrls(
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  return createSignedUrls(BUCKET, paths);
}
