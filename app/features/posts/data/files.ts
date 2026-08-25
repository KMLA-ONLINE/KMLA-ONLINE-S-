import { getSupabase } from "~/shared/supabase/client";

const BUCKET = "post-attachments";
const SIGNED_URL_CACHE_MS = 55 * 60 * 1000;

interface SignedUrlCacheEntry {
  url: string;
  expiresAt: number;
}

const signedUrlCache = new Map<string, SignedUrlCacheEntry>();

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
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) return new Map();

  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  const now = Date.now();
  const urls = new Map<string, string>();
  const missingPaths: string[] = [];

  for (const path of uniquePaths) {
    const cached = userId ? signedUrlCache.get(`${userId}:${path}`) : undefined;
    if (cached && cached.expiresAt > now) urls.set(path, cached.url);
    else missingPaths.push(path);
  }

  if (missingPaths.length === 0) return urls;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(missingPaths, 3600);
  if (error) return urls;

  for (const item of data ?? []) {
    if (!item.signedUrl || !item.path) continue;
    urls.set(item.path, item.signedUrl);
    if (userId) {
      signedUrlCache.set(`${userId}:${item.path}`, {
        url: item.signedUrl,
        expiresAt: now + SIGNED_URL_CACHE_MS,
      });
    }
  }
  return urls;
}

export function resetPostAttachmentUrlCacheForTests(): void {
  signedUrlCache.clear();
}
