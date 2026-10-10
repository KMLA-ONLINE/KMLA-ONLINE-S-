import type { PostAttachment } from "~/features/posts/model/types";
import type { Json } from "~/shared/supabase/database.types";

/**
 * 목록 RPC가 `jsonb`로 함께 내려주는 첨부 배열을 읽는다. 서명 URL은 비워 두고 호출부가 채운다.
 * 모양이 어긋난 항목은 버린다 — 첨부 하나 때문에 목록 전체가 실패하지 않게. 대신 경고를 남긴다.
 * 이 모양은 `private.post_attachments_json()`이 정하므로, 경고가 보이면 둘이 어긋난 것이다.
 */
export function readAttachmentsJson(
  value: Json | undefined,
  postId: string,
): PostAttachment[] {
  if (!Array.isArray(value)) {
    console.warn("Post attachments are not an array", { postId, value });
    return [];
  }

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
      console.warn("Dropped a malformed post attachment", { postId, item });
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

/**
 * 첨부 묶음의 원본과 축소본 경로. 한 번의 `createPostAttachmentUrls()`로 넘긴다 — 경로를 나눠
 * 두 번 부르면 서명 배치가 갈라져 왕복이 는다.
 */
export function attachmentPaths(
  attachments: readonly PostAttachment[],
): (string | null)[] {
  return attachments.flatMap((attachment) => [
    attachment.object_path,
    attachment.thumbnail_path,
  ]);
}

/** 서명에 실패한 경로는 null로 둔다. 원시 경로를 남기면 `<img src>`가 상대 경로로 나가 깨진다. */
export function applyAttachmentUrls(
  attachments: readonly PostAttachment[],
  urls: Map<string, string>,
): PostAttachment[] {
  return attachments.map((attachment) => ({
    ...attachment,
    signedUrl: urls.get(attachment.object_path) ?? null,
    thumbnailUrl: attachment.thumbnail_path
      ? (urls.get(attachment.thumbnail_path) ?? null)
      : null,
  }));
}
