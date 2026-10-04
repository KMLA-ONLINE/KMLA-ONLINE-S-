import type { ProfileMediaSlot } from "~/features/profiles/model/types";
import { getSupabase } from "~/shared/supabase/client";
import { createSignedUrls } from "~/shared/supabase/signed-urls";
import { STORAGE_UPLOAD_CACHE_CONTROL } from "~/shared/supabase/storage";

const BUCKET = "profile-media";

/** `avatar_path`·`cover_path`는 항상 이 버킷의 object 경로이거나 `null`이다(쓰는 RPC가 둘뿐이라 외부 URL이 들어올 길이 없다). */
export function createProfileMediaUrls(
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  return createSignedUrls(BUCKET, paths);
}

/** 교체 뒤 이전 이미지는 클라이언트가 지우지 않는다 — 변경 활동 게시물이 계속 참조하므로 판단과 삭제는 정리 큐가 맡는다. */
export async function replaceProfileMedia(
  slot: ProfileMediaSlot,
  file: File,
  dimensions: { width: number; height: number },
  activity: { file: File; width: number; height: number } | null = null,
): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("prepare_profile_media", {
    p_slot: slot,
    p_size_bytes: file.size,
    p_width: dimensions.width,
    p_height: dimensions.height,
    p_activity_size_bytes: activity?.file.size,
    p_activity_width: activity?.width,
    p_activity_height: activity?.height,
  });
  if (error) throw error;
  const prepared = data?.[0];
  if (!prepared) throw new Error("Profile media upload was not prepared");

  const uploads = [
    supabase.storage.from(BUCKET).upload(prepared.object_path, file, {
      contentType: "image/webp",
      cacheControl: STORAGE_UPLOAD_CACHE_CONTROL,
      upsert: false,
    }),
  ];

  if (activity && prepared.activity_object_path) {
    uploads.push(
      supabase.storage
        .from(BUCKET)
        .upload(prepared.activity_object_path, activity.file, {
          contentType: "image/webp",
          cacheControl: STORAGE_UPLOAD_CACHE_CONTROL,
          upsert: false,
        }),
    );
  }

  const results = await Promise.all(uploads);
  const uploadError = results.find((result) => result.error)?.error;
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
