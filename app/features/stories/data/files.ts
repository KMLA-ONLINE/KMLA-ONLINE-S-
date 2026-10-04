import { deleteMyStory } from "~/features/stories/data/mutations";
import { getSupabase } from "~/shared/supabase/client";
import { createSignedUrls } from "~/shared/supabase/signed-urls";
import { STORAGE_UPLOAD_CACHE_CONTROL } from "~/shared/supabase/storage";

const BUCKET = "story-media";

export function createStoryMediaUrls(
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  return createSignedUrls(BUCKET, paths);
}

/**
 * prepare → upload → publish. 중간에 실패하면 `pending` 행을 바로 지운다. 남겨 두면 24시간
 * 동안 올릴 수 있는 수의 상한을 차지해서, 업로드가 몇 번 실패한 사용자는 보이는 스토리가
 * 없는데도 상한에 걸린다. 그 삭제마저 실패하면 48시간 뒤 정리 작업이 회수한다.
 *
 * `file`은 `compressImage(…, "screen")`, `thumbnail`은 `compressImage(…, "card")`를 거친
 * WebP여야 한다.
 */
export async function createImageStory(input: {
  file: File;
  thumbnail: File;
  width: number;
  height: number;
  content: string;
  linkUrl: string | null;
}): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("prepare_image_story", {
    p_size_bytes: input.file.size,
    p_width: input.width,
    p_height: input.height,
    p_content: input.content,
    p_link_url: input.linkUrl ?? undefined,
  });

  if (error) throw error;

  const prepared = data?.[0];

  if (!prepared) throw new Error("Story upload was not prepared");

  try {
    await uploadAndPublish(prepared, input);
  } catch (cause) {
    await deleteMyStory(prepared.story_id).catch(() => undefined);
    throw cause;
  }
}

async function uploadAndPublish(
  prepared: { story_id: number; object_path: string; thumbnail_path: string },
  input: { file: File; thumbnail: File },
): Promise<void> {
  const supabase = getSupabase();
  const uploads: [string, File][] = [
    [prepared.object_path, input.file],
    [prepared.thumbnail_path, input.thumbnail],
  ];
  const results = await Promise.all(
    uploads.map(([path, file]) =>
      supabase.storage.from(BUCKET).upload(path, file, {
        contentType: "image/webp",
        cacheControl: STORAGE_UPLOAD_CACHE_CONTROL,
        upsert: false,
      }),
    ),
  );
  const uploadError = results.find((result) => result.error)?.error;

  if (uploadError) throw uploadError;

  const { error: publishError } = await supabase.rpc("publish_image_story", {
    p_story_id: prepared.story_id,
  });

  if (publishError) throw publishError;
}
