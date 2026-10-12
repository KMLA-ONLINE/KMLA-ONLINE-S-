import type {
  MessageAttachment,
  MessageAttachmentKind,
} from "~/features/messaging/model/types";
import { isSupportedImageInput } from "~/shared/lib/image/compress";

/** 메시지 하나에 붙일 수 있는 파일 수(기능 명세 §13.5). */
export const MESSAGE_ATTACHMENT_LIMIT = 10;
/** 정규화하지 않는 파일(일반 파일, 오디오, 동영상)의 상한. 서버와 버킷이 같은 값을 강제한다. */
export const MESSAGE_FILE_MAX_BYTES = 30 * 1024 * 1024;

/**
 * 고른 파일의 첨부 종류. 사진은 업로드 전에 WebP로 정규화한다. GIF는 사진으로 다루지 않고 움직이는
 * 이미지로 재생하지도 않는다. 일반 파일로 내려받기만 준다.
 */
export function classifyAttachment(file: File): MessageAttachmentKind {
  if (isSupportedImageInput(file)) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

export function isMediaKind(kind: MessageAttachmentKind): boolean {
  return kind === "image" || kind === "video";
}

/**
 * 고른 파일을 메시지로 나눈다. 사진과 동영상은 열 개씩 한 묶음 메시지로, 일반 파일과 오디오는
 * 파일마다 메시지 하나로 보낸다(기능 명세 §13.5). 고른 순서를 지킨다.
 */
export function groupAttachmentsIntoMessages(files: File[]): File[][] {
  const media = files.filter((file) => isMediaKind(classifyAttachment(file)));
  const others = files.filter((file) => !isMediaKind(classifyAttachment(file)));
  const groups: File[][] = [];
  for (let start = 0; start < media.length; start += MESSAGE_ATTACHMENT_LIMIT) {
    groups.push(media.slice(start, start + MESSAGE_ATTACHMENT_LIMIT));
  }
  return [...groups, ...others.map((file) => [file])];
}

/** 대화 목록과 Push에서 첨부만 있는 메시지를 부를 이름. 파일 이름은 쓰지 않는다. */
export function attachmentKindLabel(kind: MessageAttachmentKind): string {
  switch (kind) {
    case "image":
      return "사진";
    case "video":
      return "동영상";
    default:
      return "파일";
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 앱 안에서 재생할 수 있는 형식. 그 밖은 내려받기로만 준다(Storage 설계 §6.4). */
type PlayableFormat =
  | "video/mp4"
  | "video/webm"
  | "video/quicktime"
  | "audio/mpeg"
  | "audio/mp4"
  | "audio/ogg"
  | "audio/wav"
  | "audio/webm";

/**
 * 내려받은 파일의 앞부분(magic bytes)으로 실제 형식을 확인한다. 확장자와 업로더가 보낸 MIME type은
 * 믿지 않는다. 재생할 수 있는 형식이 아니면 `null`이다.
 */
export function sniffPlayableFormat(
  bytes: Uint8Array,
  kind: MessageAttachment["kind"],
): PlayableFormat | null {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  const isWebm =
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3;

  if (kind === "video") {
    if (ascii(4, 4) === "ftyp") {
      return ascii(8, 2) === "qt" ? "video/quicktime" : "video/mp4";
    }
    if (isWebm) return "video/webm";
    return null;
  }
  if (kind === "audio") {
    if (
      ascii(0, 3) === "ID3" ||
      (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
    ) {
      return "audio/mpeg";
    }
    if (ascii(4, 4) === "ftyp") return "audio/mp4";
    if (ascii(0, 4) === "OggS") return "audio/ogg";
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
    if (isWebm) return "audio/webm";
  }
  return null;
}
