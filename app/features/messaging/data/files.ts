import {
  classifyAttachment,
  MESSAGE_FILE_MAX_BYTES,
  sniffPlayableFormat,
} from "~/features/messaging/model/attachments";
import type {
  MessageAttachment,
  MessageAttachmentKind,
} from "~/features/messaging/model/types";
import { MAX_INPUT_FILE_BYTES } from "~/shared/lib/file-policy";
import { compressImage, getImageDimensions } from "~/shared/lib/image/compress";
import { getSupabase } from "~/shared/supabase/client";
import { createSignedUrls } from "~/shared/supabase/signed-urls";
import { uploadStorageObject } from "~/shared/supabase/upload";

const BUCKET = "message-attachments";

/** 업로드할 준비가 된 첨부 하나. 사진은 정규화한 WebP와 목록용 축소본이다. */
export interface PreparedAttachment {
  kind: MessageAttachmentKind;
  file: File;
  thumbnail: File | null;
  fileName: string;
  width: number | null;
  height: number | null;
}

/**
 * 고른 파일을 업로드할 수 있게 만든다. 사진은 EXIF를 지우고 WebP로 다시 인코딩한다(Storage 설계
 * §6.2). 그 밖의 파일은 형식과 관계없이 그대로 올리되 30MiB를 넘으면 거부한다.
 */
export async function prepareAttachment(
  source: File,
): Promise<PreparedAttachment> {
  const kind = classifyAttachment(source);
  if (kind === "image") {
    if (source.size > MAX_INPUT_FILE_BYTES) {
      throw new Error(`사진은 30MB 이하여야 합니다: ${source.name}`);
    }
    const file = await compressImage(source, "photo");
    const [width, height] = await getImageDimensions(file);
    // 축소본은 목록 데이터를 줄이는 수단이다. 만들지 못해도 원본을 그리면 되므로 실패를 삼킨다.
    const thumbnail = await compressImage(file, "thumbnail").catch(() => null);
    return { kind, file, thumbnail, fileName: file.name, width, height };
  }
  if (source.size > MESSAGE_FILE_MAX_BYTES) {
    throw new Error(`파일은 30MB 이하여야 합니다: ${source.name}`);
  }
  if (source.size === 0) {
    throw new Error(`빈 파일은 보낼 수 없습니다: ${source.name}`);
  }
  return {
    kind,
    file: source,
    thumbnail: null,
    fileName: source.name.slice(0, 255) || "file",
    width: null,
    height: null,
  };
}

/**
 * 첨부를 예고하고 정확히 그 경로에 올린다. 업로드가 끝난 첨부를 돌려주며, 메시지는 이어서
 * `sendMessage`가 같은 ID로 보내 서버가 확정한다. 같은 메시지 ID로 다시 부르면 이전 예고를 버린다.
 */
export async function uploadAttachments(
  conversationId: string,
  messageId: string,
  attachments: PreparedAttachment[],
  onProgress?: (progress: number) => void,
): Promise<MessageAttachment[]> {
  const { data, error } = await getSupabase().rpc(
    "prepare_message_attachments",
    {
      p_conversation_id: conversationId,
      p_message_id: messageId,
      p_files: attachments.map((attachment) => ({
        kind: attachment.kind,
        mime_type: attachment.file.type || "application/octet-stream",
        size_bytes: attachment.file.size,
        width: attachment.width,
        height: attachment.height,
        file_name: attachment.fileName,
      })),
    },
  );
  if (error) throw error;
  const targets = data ?? [];
  if (targets.length !== attachments.length) {
    throw new Error("Attachment upload was not prepared");
  }

  const totalBytes = attachments.reduce(
    (sum, attachment) => sum + attachment.file.size,
    0,
  );
  const uploaded = new Map<number, number>();
  const report = () =>
    onProgress?.(
      [...uploaded.values()].reduce((sum, bytes) => sum + bytes, 0) /
        totalBytes,
    );

  await Promise.all(
    targets.map(async (target, index) => {
      const attachment = attachments[index];
      await uploadStorageObject(
        BUCKET,
        target.object_path,
        attachment.file,
        (progress) => {
          uploaded.set(index, progress * attachment.file.size);
          report();
        },
      );
      if (attachment.thumbnail && target.thumbnail_path) {
        // 축소본이 올라가지 않아도 전송은 막지 않는다. 서버가 축소본 경로를 비운다.
        await uploadStorageObject(
          BUCKET,
          target.thumbnail_path,
          attachment.thumbnail,
        ).catch(() => undefined);
      }
    }),
  );

  return targets.map((target, index) => {
    const attachment = attachments[index];
    return {
      id: target.attachment_id,
      kind: attachment.kind,
      mimeType: attachment.file.type || "application/octet-stream",
      sizeBytes: attachment.file.size,
      width: attachment.width,
      height: attachment.height,
      fileName: attachment.fileName,
      objectPath: target.object_path,
      thumbnailPath: attachment.thumbnail ? target.thumbnail_path : null,
    };
  });
}

/** 첨부 object의 signed URL. 같은 경로는 만료 전까지 다시 서명하지 않는다. */
export function createAttachmentUrls(
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  return createSignedUrls(BUCKET, paths);
}

/** signed URL에 `download`를 붙여 서버가 첨부로 내려주게 한다. 다른 출처라 `<a download>`가 무시된다. */
export function toDownloadUrl(signedUrl: string, fileName: string): string {
  const url = new URL(signedUrl);
  url.searchParams.set("download", fileName);
  return url.toString();
}

/**
 * 오디오·동영상을 내려받아 앞부분으로 실제 형식을 확인하고, 통제된 MIME type의 Blob URL로
 * 돌려준다. 재생할 수 있는 형식이 아니면 `null`이다(Storage 설계 §6.4). 다 쓴 URL은 호출한 쪽이
 * `URL.revokeObjectURL`로 거둔다.
 */
export async function loadPlayableAttachment(
  attachment: MessageAttachment,
): Promise<string | null> {
  const urls = await createAttachmentUrls([attachment.objectPath]);
  const signed = urls.get(attachment.objectPath);
  if (!signed) throw new Error("Attachment URL is unavailable");
  const response = await fetch(signed);
  if (!response.ok)
    throw new Error(`Attachment download failed: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const format = sniffPlayableFormat(
    new Uint8Array(buffer.slice(0, 16)),
    attachment.kind,
  );
  if (!format) return null;
  return URL.createObjectURL(new Blob([buffer], { type: format }));
}
