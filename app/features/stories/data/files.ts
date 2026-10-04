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
 * prepare → upload → publish. 아직 게시되지 않은 것이 확실할 때만 `pending` 행을 바로 지운다.
 * 남겨 두면 올릴 수 있는 수의 상한을 차지해서, 업로드가 몇 번 실패한 사용자는 보이는 스토리가
 * 없는데도 상한에 걸린다. 게시 RPC의 응답이 끊긴 경우는 서버에서 이미 게시됐을 수 있으므로
 * 지우지 않는다. 남은 행은 48시간 뒤 정리 작업이 회수한다.
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
    if (!(cause instanceof PublishUnconfirmedError)) {
      await deleteMyStory(prepared.story_id).catch(() => undefined);
    }
    throw cause;
  }
}

/** 게시 요청이 서버에 닿았는지 모르는 실패. 이미 게시됐을 수 있어 되돌리지 않는다. */
class PublishUnconfirmedError extends Error {}

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

  // 서버가 거절한 오류에는 SQLSTATE가 붙는다. 없으면 응답을 받지 못한 것이다.
  if (publishError && !publishError.code) {
    throw new PublishUnconfirmedError(publishError.message, {
      cause: publishError,
    });
  }
  if (publishError) throw publishError;
}
