import { getSupabase } from "~/shared/supabase/client";

const BUCKET = "post-attachments";
const SIGNED_URL_CACHE_MS = 55 * 60 * 1000;

interface SignedUrlCacheEntry {
  url: string;
  expiresAt: number;
}

const signedUrlCache = new Map<string, SignedUrlCacheEntry>();
const pendingSignedUrls = new Map<string, Promise<string | null>>();

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
  const pending: [string, Promise<string | null>][] = [];

  for (const path of uniquePaths) {
    const key = userId ? `${userId}:${path}` : path;
    const cached = userId ? signedUrlCache.get(key) : undefined;
    if (cached && cached.expiresAt > now) urls.set(path, cached.url);
    else {
      if (cached) signedUrlCache.delete(key);
      const existing = pendingSignedUrls.get(key);
      if (existing) pending.push([path, existing]);
      else missingPaths.push(path);
    }
  }

  if (missingPaths.length > 0) {
    const request = supabase.storage
      .from(BUCKET)
      .createSignedUrls(missingPaths, 3600);
    for (const path of missingPaths) {
      const key = userId ? `${userId}:${path}` : path;
      const promise = request
        .then(({ data, error }) => {
          if (error) return null;
          return data?.find((item) => item.path === path)?.signedUrl ?? null;
        })
        .finally(() => pendingSignedUrls.delete(key));
      pendingSignedUrls.set(key, promise);
      pending.push([path, promise]);
    }
  }

  for (const [path, promise] of pending) {
    const url = await promise;
    if (!url) continue;
    urls.set(path, url);
    if (userId)
      signedUrlCache.set(`${userId}:${path}`, {
        url,
        expiresAt: now + SIGNED_URL_CACHE_MS,
      });
  }
  return urls;
}

export function resetPostAttachmentUrlCacheForTests(): void {
  signedUrlCache.clear();
  pendingSignedUrls.clear();
}
