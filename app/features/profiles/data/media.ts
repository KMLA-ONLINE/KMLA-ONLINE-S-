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

  for (const path of storagePaths) {
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
    if (!item.path || !item.signedUrl) continue;
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
