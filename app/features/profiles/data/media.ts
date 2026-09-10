import type { ProfileMediaSlot } from "~/features/profiles/model/types";
import { getSupabase } from "~/shared/supabase/client";
import { createSignedUrls } from "~/shared/supabase/signed-urls";
import { STORAGE_UPLOAD_CACHE_CONTROL } from "~/shared/supabase/storage";

const BUCKET = "profile-media";

/**
 * `profiles.avatar_path`와 `cover_path`는 언제나 이 버킷의 object 경로이거나 `null`이다.
 * 두 컬럼에 쓰는 곳은 `finalize_profile_media()`(→ `object_path`)와
 * `remove_my_profile_media()`(→ `null`) 둘뿐이라, 완성된 외부 URL이 들어올 길이 없다.
 */
export function createProfileMediaUrls(
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  return createSignedUrls(BUCKET, paths);
}

/**
 * 교체하고 남은 이전 이미지는 클라이언트가 지우지 않는다. 프로필 슬롯에서 내려와도 그 이미지를
 * 만든 변경 활동 게시물이 계속 참조하고, 그 게시물이 삭제된 뒤에야 지울 수 있기 때문이다.
 * 판단과 삭제는 모두 `private.enqueue_storage_cleanup()`과 정리 큐가 맡는다.
 */
export async function replaceProfileMedia(
  slot: ProfileMediaSlot,
  file: File,
  dimensions: { width: number; height: number },
): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("prepare_profile_media", {
    p_slot: slot,
    p_size_bytes: file.size,
    p_width: dimensions.width,
    p_height: dimensions.height,
  });
  if (error) throw error;
  const prepared = data?.[0];
  if (!prepared) throw new Error("Profile media upload was not prepared");

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(prepared.object_path, file, {
      contentType: "image/webp",
      cacheControl: STORAGE_UPLOAD_CACHE_CONTROL,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { error: finalizeError } = await supabase.rpc(
    "finalize_profile_media",
    { p_media_id: prepared.media_id },
  );
  if (finalizeError) throw finalizeError;
}

export async function removeProfileMedia(
  slot: ProfileMediaSlot,
): Promise<void> {
  const { error } = await getSupabase().rpc("remove_my_profile_media", {
    p_slot: slot,
  });
  if (error) throw error;
}
