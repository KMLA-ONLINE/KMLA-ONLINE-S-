import type {
  AcceptedProfile,
  ProfileMediaSlot,
} from "~/features/profiles/model/types";
import { getSupabase } from "~/shared/supabase/client";
import { createSignedUrls } from "~/shared/supabase/signed-urls";

const BUCKET = "profile-media";

/**
 * 신입생 임시 아바타처럼 Storage 밖에 있는 이미지는 경로가 아니라 이미 완성된 URL이다.
 * 서명 대상에서 빼고 그대로 돌려준다.
 */
function isExternalUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

export async function createProfileMediaUrls(
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const uniquePaths = [
    ...new Set(paths.filter((path): path is string => Boolean(path))),
  ];
  const urls = await createSignedUrls(
    BUCKET,
    uniquePaths.filter((path) => !isExternalUrl(path)),
  );

  for (const path of uniquePaths) {
    if (isExternalUrl(path)) urls.set(path, path);
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
