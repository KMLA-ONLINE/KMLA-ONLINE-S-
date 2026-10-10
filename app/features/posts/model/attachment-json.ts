import type { PostAttachment } from "~/features/posts/model/types";
import type { Json } from "~/shared/supabase/database.types";

/**
 * 목록 RPC가 `jsonb`로 함께 내려주는 첨부 배열을 읽는다. 서명 URL은 비워 두고 호출부가 채운다.
 * 모양이 어긋난 항목은 버린다 — 첨부 하나 때문에 목록 전체가 실패하지 않게.
 */
export function readAttachmentsJson(
  value: Json,
  postId: string,
): PostAttachment[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (
      !item ||
      Array.isArray(item) ||
      typeof item !== "object" ||
      typeof item.attachment_id !== "string" ||
      typeof item.object_path !== "string" ||
      typeof item.original_filename !== "string" ||
      typeof item.storage_bucket !== "string" ||
      typeof item.mime_type !== "string" ||
      typeof item.position !== "number" ||
      typeof item.size_bytes !== "number"
    ) {
      return [];
    }

    return [
      {
        attachment_id: item.attachment_id,
        post_id: postId,
        storage_bucket: item.storage_bucket,
        object_path: item.object_path,
        original_filename: item.original_filename,
        position: item.position,
        mime_type: item.mime_type,
        size_bytes: item.size_bytes,
        width: typeof item.width === "number" ? item.width : null,
        height: typeof item.height === "number" ? item.height : null,
        signedUrl: null,
        thumbnail_path:
          typeof item.thumbnail_path === "string" ? item.thumbnail_path : null,
        thumbnailUrl: null,
      },
    ];
  });
}
