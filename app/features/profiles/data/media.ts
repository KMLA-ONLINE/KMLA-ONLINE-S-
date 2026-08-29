import type {
  AcceptedProfile,
  ProfileMediaSlot,
} from "~/features/profiles/model/types";
import { getSupabase } from "~/shared/supabase/client";

const BUCKET = "profile-media";
const SIGNED_URL_CACHE_MS = 55 * 60 * 1000;

interface SignedUrlCacheEntry {
  url: string;
  expiresAt: number;
}

const signedUrlCache = new Map<string, SignedUrlCacheEntry>();
const pendingSignedUrls = new Map<string, Promise<string | null>>();

function isExternalUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

export async function createProfileMediaUrls(
  paths: (string | null)[],
): Promise<Map<string, string>> {
  const uniquePaths = [
    ...new Set(paths.filter((path): path is string => Boolean(path))),
  ];
  const urls = new Map<string, string>();

  for (const path of uniquePaths) {
    if (isExternalUrl(path)) urls.set(path, path);
  }

  const storagePaths = uniquePaths.filter((path) => !isExternalUrl(path));
  if (storagePaths.length === 0) return urls;

  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  const now = Date.now();
  const missingPaths: string[] = [];
  const pending: [string, Promise<string | null>][] = [];

  for (const path of storagePaths) {
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

export async function replaceProfileMedia(
  profile: AcceptedProfile,
  slot: ProfileMediaSlot,
  file: File,
): Promise<void> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;

  if (!userId) throw new Error("Authentication required.");

  const objectPath = `${userId}/${slot}/${crypto.randomUUID()}`;
  const previousPath =
    slot === "avatar" ? profile.avatar_path : profile.cover_path;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, file, {
      contentType: "image/webp",
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { error: connectError } = await supabase.rpc("set_my_profile_media", {
    p_slot: slot,
    p_object_path: objectPath,
  });

  if (connectError) {
    await supabase.storage.from(BUCKET).remove([objectPath]);
    throw connectError;
  }

  // Storage RLS가 현재 프로필과 살아 있는 활동 게시물의 스냅샷은 보존한다.
  if (previousPath && !isExternalUrl(previousPath)) {
    await supabase.storage.from(BUCKET).remove([previousPath]);
  }
}

export async function removeProfileMedia(
  profile: AcceptedProfile,
  slot: ProfileMediaSlot,
): Promise<void> {
  const supabase = getSupabase();
  const previousPath =
    slot === "avatar" ? profile.avatar_path : profile.cover_path;

  const { error } = await supabase.rpc("remove_my_profile_media", {
    p_slot: slot,
  });
  if (error) throw error;

  if (previousPath && !isExternalUrl(previousPath)) {
    await supabase.storage.from(BUCKET).remove([previousPath]);
  }
}
