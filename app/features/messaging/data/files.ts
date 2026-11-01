import {
  classifyAttachment,
  MESSAGE_FILE_MAX_BYTES,
  sniffAudioFormat,
} from "~/features/messaging/model/attachments";
import type {
  MessageAttachment,
  MessageAttachmentKind,
} from "~/features/messaging/model/types";
import { MAX_INPUT_FILE_BYTES } from "~/shared/lib/file-policy";
import { compressImage, getImageDimensions } from "~/shared/lib/image/compress";
import {
  asMotionKind,
  transcodeMotion,
} from "~/shared/lib/media/motion-policy";
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
 * 고른 파일을 업로드할 수 있게 만든다. 사진은 EXIF를 지우고 WebP로, 동영상과 GIF는 태그를 지우고
 * MP4로 다시 인코딩한다(Storage 설계 §6.2, §6.5). 그 밖의 파일은 형식과 관계없이 그대로 올리되 30MiB를 넘으면 거부한다.
 */
export async function prepareAttachment(
  source: File,
  onMotionProgress?: (progress: number) => void,
): Promise<PreparedAttachment> {
  const kind = classifyAttachment(source);
  if (asMotionKind(kind)) {
    const result = await transcodeMotion(source, {
      onProgress: onMotionProgress,
    });
    return {
      kind: result.kind,
      file: result.file,
      thumbnail: result.poster,
      fileName: result.file.name,
      width: result.width,
      height: result.height,
    };
  }
  if (kind === "image") {
    if (source.size > MAX_INPUT_FILE_BYTES) {
      throw new Error(`사진은 30MB 이하여야 합니다: ${source.name}`);
    }
    // 채팅 사진은 휴대폰 화면 한 장 크기(2048px)면 충분하다. 글 첨부의 `photo`(3072px)보다 작아
    // 원본도 대개 1MiB 아래로 내려와 Service Worker 미디어 캐시에 들어간다.
    const file = await compressImage(source, "screen");
    const [width, height] = await getImageDimensions(file);
    // 축소본은 대화방에 까는 이미지다. 말풍선 사진은 최대 288 CSS px라 640px이면 DPR 2에서도
    // 충분하다. 만들지 못해도 원본을 그리면 되므로 실패를 삼킨다.
    const thumbnail = await compressImage(file, "card").catch(() => null);
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
      // 서버는 예고한 첨부가 모두 올라와야 메시지를 확정한다. 한 장이 잠깐 끊겨 묶음 전체가 실패하지
      // 않도록 그 첨부만 다시 올린다.
      await uploadWithRetry(
        BUCKET,
        target.object_path,
        attachment.file,
        (progress) => {
          uploaded.set(index, progress * attachment.file.size);
          report();
        },
      );
      if (attachment.thumbnail && target.thumbnail_path) {
        // 축소본이 없으면 대화방이 원본을 그리므로 한 번 더 시도한다. 그래도 올라가지 않으면
        // 전송은 막지 않는다. 서버가 축소본 경로를 비운다.
        const thumbnail = attachment.thumbnail;
        const thumbnailPath = target.thumbnail_path;
        await uploadStorageObject(BUCKET, thumbnailPath, thumbnail)
          .catch(() => uploadStorageObject(BUCKET, thumbnailPath, thumbnail))
          .catch(() => undefined);
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

/**
 * 이미 보낸 첨부를 다른 대화의 새 메시지 첨부로 예고하고 Storage 안에서 복사한다. 파일이 기기를
 * 거치지 않는다. 복사본은 원본과 따로 남아 원본 메시지를 지워도 그대로다. 메시지는 이어서 같은 ID로
 * 보내 서버가 확정한다. 그 ID의 메시지가 이미 저장됐으면(응답만 잃은 다시 보내기) 복사하지 않고
 * `false`를 돌려준다.
 *
 * 사진 30장을 여러 대화에 보내면 요청이 수백 개라 한 번에 하나씩 복사한다. 전달은 기다려도 되는
 * 작업이고, 한꺼번에 보내면 모바일 연결이 막혀 일부가 실패한다.
 */
export async function copyAttachments(
  conversationId: string,
  messageId: string,
  attachments: readonly MessageAttachment[],
): Promise<boolean> {
  const { data, error } = await getSupabase().rpc(
    "prepare_message_attachments",
    {
      p_conversation_id: conversationId,
      p_message_id: messageId,
      p_files: attachments.map((attachment) => ({
        kind: attachment.kind,
        mime_type: attachment.mimeType,
        size_bytes: attachment.sizeBytes,
        width: attachment.width,
        height: attachment.height,
        file_name: attachment.fileName,
      })),
    },
  );
  if (error?.code === "23505") return false;
  if (error) throw error;
  const targets = data ?? [];
  if (targets.length !== attachments.length) {
    throw new Error("Attachment copy was not prepared");
  }

  for (const [index, target] of targets.entries()) {
    const source = attachments[index];
    await copyWithRetry(source.objectPath, target.object_path);
    // 축소본이 없으면 대화방이 원본을 그린다. 서버가 축소본 경로를 비우므로 전송은 막지 않는다.
    if (source.thumbnailPath && target.thumbnail_path) {
      await copyWithRetry(source.thumbnailPath, target.thumbnail_path).catch(
        () => undefined,
      );
    }
  }
  return true;
}

/** 첫 시도를 포함해 올려 보는 횟수. */
const UPLOAD_ATTEMPTS = 3;
const UPLOAD_RETRY_DELAY_MS = 800;

/**
 * 올리기가 실패하면 잠시 쉬었다가 같은 경로로 다시 올린다. 앞선 시도가 사실은 저장까지 마치고 응답만
 * 잃었으면 덮어쓰지 않는 업로드가 "이미 있음"으로 거절하는데, 그건 올라간 것이므로 성공으로 본다.
 */
async function uploadWithRetry(
  bucket: string,
  path: string,
  file: File,
  onProgress: (progress: number) => void,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await uploadStorageObject(bucket, path, file, onProgress);
      return;
    } catch (error) {
      if (attempt > 1 && isAlreadyUploaded(error)) return;
      if (attempt >= UPLOAD_ATTEMPTS) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, UPLOAD_RETRY_DELAY_MS * attempt),
      );
    }
  }
}

/** `uploadWithRetry`와 같은 규칙으로 Storage 안에서 복사한다. */
async function copyWithRetry(from: string, to: string): Promise<void> {
  const bucket = getSupabase().storage.from(BUCKET);
  for (let attempt = 1; ; attempt += 1) {
    const { error } = await bucket.copy(from, to);
    if (!error || (attempt > 1 && isAlreadyUploaded(error))) return;
    if (attempt >= UPLOAD_ATTEMPTS) throw error;
    await new Promise((resolve) =>
      setTimeout(resolve, UPLOAD_RETRY_DELAY_MS * attempt),
    );
  }
}

function isAlreadyUploaded(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status, statusCode, message } = error as {
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };
  return (
    status === 409 ||
    statusCode === "409" ||
    (typeof message === "string" && /already exists|duplicate/i.test(message))
  );
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
 * 오디오를 내려받아 앞부분으로 실제 형식을 확인하고, 통제된 MIME type의 Blob URL로
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
  const format = sniffAudioFormat(new Uint8Array(buffer.slice(0, 16)));
  if (!format) return null;
  return URL.createObjectURL(new Blob([buffer], { type: format }));
}
