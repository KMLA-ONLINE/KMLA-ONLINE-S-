import type { MessageAttachmentKind } from "~/features/messaging/model/types";
import { MAX_INPUT_FILE_BYTES } from "~/shared/lib/file-policy";
import { isSupportedImageInput } from "~/shared/lib/image/compress";
import { translate, type Locale } from "~/shared/i18n";

/** 한 번에 보낼 수 있는 사진 수. 모두 메시지 하나에 묶이고, 서버도 같은 상한을 강제한다(기능 명세 §13.5). */
export const MESSAGE_PHOTO_LIMIT = 30;
/** 한 번에 보낼 수 있는 일반 파일·오디오 수. 파일마다 메시지 하나다. */
export const MESSAGE_FILE_LIMIT = 10;
/** 정규화하지 않는 파일(일반 파일, 오디오)의 상한. 서버와 버킷이 같은 값을 강제한다. */
export const MESSAGE_FILE_MAX_BYTES = 30 * 1024 * 1024;

const BLOCKED_EXTENSION =
  /\.(gif|mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp|3g2|mpe?g|ogv)$/i;

/**
 * 보낼 수 없는 파일. 동영상과 GIF는 어느 버튼으로도 첨부하지 않는다(기능 명세 §13.5). 기기가 MIME
 * type을 비워 줄 수 있어 확장자도 본다. 서버의 `prepare_message_attachments`가 같은 규칙을 강제한다.
 */
export function isBlockedAttachment(file: File): boolean {
  const type = file.type.toLowerCase();
  return (
    type.startsWith("video/") ||
    type === "image/gif" ||
    // WebM 오디오처럼 오디오로 밝힌 파일은 확장자가 같아도 보낸다.
    (!type.startsWith("audio/") && BLOCKED_EXTENSION.test(file.name.trim()))
  );
}

/**
 * 고른 파일의 첨부 종류. 사진은 업로드 전에 WebP로 정규화한다. 동영상과 GIF는 `isBlockedAttachment`가
 * 먼저 걸러 여기에 오지 않는다.
 */
export function classifyAttachment(file: File): MessageAttachmentKind {
  if (isSupportedImageInput(file)) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

/**
 * 한 번에 보낼 수 있는 만큼만 남긴다. 이미 고른 첨부(`kept`)까지 합쳐 사진은 30장, 파일은 10개까지다.
 * 넘친 것이 있으면 `overflow`가 참이다. 고른 순서를 지킨다.
 */
export function limitAttachments(
  files: readonly File[],
  kept: readonly File[] = [],
): { files: File[]; overflow: boolean } {
  let photos = kept.filter((file) => isPhoto(file)).length;
  let others = kept.length - photos;
  const accepted = files.filter((file) => {
    if (isPhoto(file)) return ++photos <= MESSAGE_PHOTO_LIMIT;
    return ++others <= MESSAGE_FILE_LIMIT;
  });
  return { files: accepted, overflow: accepted.length < files.length };
}

export const ATTACHMENT_LIMIT_MESSAGE = `사진은 한 번에 ${MESSAGE_PHOTO_LIMIT}장, 파일은 ${MESSAGE_FILE_LIMIT}개까지 보낼 수 있습니다.`;

function attachmentLimitMessage(locale: Locale): string {
  return translate(
    locale,
    "사진은 한 번에 {photos}장, 파일은 {files}개까지 보낼 수 있습니다.",
    { photos: MESSAGE_PHOTO_LIMIT, files: MESSAGE_FILE_LIMIT },
  );
}

/**
 * 고른 파일 중 보낼 수 있는 것만 남기고, 뺀 이유를 알릴 문구를 모은다. 동영상과 GIF, 크기 상한을 넘거나
 * 빈 파일을 먼저 빼고, 남은 것으로 개수 상한(`limitAttachments`)을 센다. 크기는 올릴 때
 * `prepareAttachment`도 다시 보지만, 여기서 거르지 않으면 보내는 중 말풍선이 생겼다가 실패하고
 * `다시 보내기`도 같은 이유로 계속 실패한다.
 */
export function screenAttachments(
  selected: readonly File[],
  kept: readonly File[] = [],
  locale: Locale = "ko",
): { files: File[]; notices: string[] } {
  const notices: string[] = [];
  const allowed = selected.filter((file) => !isBlockedAttachment(file));
  if (allowed.length < selected.length) {
    notices.push(translate(locale, "동영상과 GIF는 보낼 수 없습니다."));
  }
  const tooLarge = allowed.filter(
    (file) =>
      file.size >
      (isPhoto(file) ? MAX_INPUT_FILE_BYTES : MESSAGE_FILE_MAX_BYTES),
  );
  if (tooLarge.length > 0) {
    notices.push(describeRejected(tooLarge, "30MB를 넘는 파일은", locale));
  }
  const empty = allowed.filter((file) => file.size === 0 && !isPhoto(file));
  if (empty.length > 0)
    notices.push(describeRejected(empty, "빈 파일은", locale));
  const { files, overflow } = limitAttachments(
    allowed.filter((file) => !tooLarge.includes(file) && !empty.includes(file)),
    kept,
  );
  if (overflow) notices.push(attachmentLimitMessage(locale));
  return { files, notices };
}

// 주어(`30MB를 넘는 파일은`)도 사전 키라 영어에서는 따로 번역된다.
function describeRejected(
  files: File[],
  subject: string,
  locale: Locale,
): string {
  const [only] = files;
  const params = { subject: translate(locale, subject), count: files.length };
  return files.length === 1 && only
    ? translate(locale, "{subject} 보낼 수 없습니다: {name}", {
        ...params,
        name: only.name,
      })
    : translate(locale, "{subject} 보낼 수 없습니다 ({count}개).", params);
}

function isPhoto(file: File): boolean {
  return classifyAttachment(file) === "image";
}

/**
 * 고른 파일을 메시지로 나눈다. 사진은 모두 한 묶음 메시지로, 일반 파일과 오디오는 파일마다 메시지
 * 하나로 보낸다(기능 명세 §13.5). 개수는 `limitAttachments`가 먼저 줄인다. 고른 순서를 지킨다.
 */
export function groupAttachmentsIntoMessages(files: File[]): File[][] {
  const photos = files.filter(isPhoto);
  const others = files.filter((file) => !isPhoto(file));
  return [
    ...(photos.length > 0 ? [photos] : []),
    ...others.map((file) => [file]),
  ];
}

/** 대화 목록과 Push에서 첨부만 있는 메시지를 부를 이름. 파일 이름은 쓰지 않는다. */
export function attachmentKindLabel(
  kind: MessageAttachmentKind,
  locale: Locale = "ko",
): string {
  switch (kind) {
    case "image":
      return translate(locale, "사진");
    default:
      return translate(locale, "파일");
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 앱 안에서 재생할 수 있는 오디오 형식. 그 밖은 내려받기로만 준다(Storage 설계 §6.4). */
type PlayableAudioFormat =
  "audio/mpeg" | "audio/mp4" | "audio/ogg" | "audio/wav" | "audio/webm";

/**
 * 내려받은 오디오의 앞부분(magic bytes)으로 실제 형식을 확인한다. 확장자와 업로더가 보낸 MIME type은
 * 믿지 않는다. 재생할 수 있는 형식이 아니면 `null`이다.
 */
export function sniffAudioFormat(
  bytes: Uint8Array,
): PlayableAudioFormat | null {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  if (
    ascii(0, 3) === "ID3" ||
    (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
  ) {
    return "audio/mpeg";
  }
  if (ascii(4, 4) === "ftyp") return "audio/mp4";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "audio/webm";
  }
  return null;
}
