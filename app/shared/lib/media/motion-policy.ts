import { MAX_INPUT_FILE_BYTES } from "~/shared/lib/file-policy";
import { IMAGE_INPUT_ACCEPT } from "~/shared/lib/image/compress";

/** 움직이는 첨부의 종류. 둘 다 저장 형식은 MP4이고, 재생 방식과 상한만 다르다(Storage 설계 §6.5). */
export type MotionKind = "video" | "gif";

export const MOTION_MAX_BYTES: Record<MotionKind, number> = {
  video: 50 * 1024 * 1024,
  gif: 5 * 1024 * 1024,
};
export const VIDEO_MAX_EDGE = 1600;
export const VIDEO_MAX_FRAME_RATE = 30;
export const VIDEO_BITRATE = 3_500_000;
export const VIDEO_AUDIO_BITRATE = 96_000;
export const GIF_MAX_EDGE = 720;
export const GIF_BITRATE = 1_500_000;

/** 첨부 종류 문자열 중 동영상과 GIF만 골라낸다. 메시지 `kind`와 게시물 `media_kind`가 함께 쓴다. */
export function asMotionKind(
  kind: string | null | undefined,
): MotionKind | null {
  return kind === "video" || kind === "gif" ? kind : null;
}

const VIDEO_EXTENSION =
  /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp|3g2|mpe?g|ogv|m2ts)$/i;

/** 사진 버튼이 고르는 형식. 프로필처럼 움직이는 첨부를 받지 않는 곳은 `IMAGE_INPUT_ACCEPT`를 쓴다. */
export const MEDIA_INPUT_ACCEPT = `${IMAGE_INPUT_ACCEPT},image/gif,video/*`;

/** 고른 파일이 동영상이나 GIF인지. 기기가 MIME type을 비워 줄 수 있어 확장자도 본다. */
export function motionKindOf(
  file: Pick<File, "name" | "type">,
): MotionKind | null {
  const type = file.type.toLowerCase();
  const name = file.name.trim();
  if (type === "image/gif" || (!type && /\.gif$/i.test(name))) return "gif";
  if (type.startsWith("audio/")) return null;
  if (type.startsWith("video/") || VIDEO_EXTENSION.test(name)) return "video";
  return null;
}

/** 압축을 시작하기 전에 거를 수 있는 입력의 거절 문구. 동영상은 입력 크기가 아니라 압축 결과로 판단한다. */
export function motionInputError(file: File): string | null {
  if (file.size === 0) return `빈 파일은 첨부할 수 없습니다: ${file.name}`;
  if (motionKindOf(file) === "gif" && file.size > MAX_INPUT_FILE_BYTES) {
    return `GIF는 30MB 이하여야 합니다: ${file.name}`;
  }
  return null;
}

/**
 * 길이로 어림한 압축 결과가 상한의 두 배를 넘는지. 정적인 영상은 목표 비트레이트보다 작게 나오므로
 * 상한 근처는 실제로 압축해 본다. 이 판단은 몇 분 압축한 뒤에야 거절하는 일만 막는다.
 */
export function exceedsVideoEstimate(durationSeconds: number): boolean {
  const estimated =
    ((VIDEO_BITRATE + VIDEO_AUDIO_BITRATE) / 8) * durationSeconds;
  return estimated > MOTION_MAX_BYTES.video * 2;
}

/** 긴 변을 줄이고 인코더가 요구하는 짝수 치수로 맞춘다. 원본보다 키우지 않는다. */
export function fitMotionSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);
  return { width: even(width * scale), height: even(height * scale) };
}

/** 다시 해도 같은 결과인 거절. 문구를 그대로 사용자에게 보인다. */
export class MotionRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MotionRejectedError";
  }
}

/** 기기가 압축할 수 없을 때. 원본은 위치 정보를 담을 수 있어 그대로 올리지 않는다. */
export class MotionUnsupportedError extends MotionRejectedError {
  constructor(fileName: string) {
    super(`이 기기에서는 압축할 수 없어 첨부하지 못했습니다: ${fileName}`);
    this.name = "MotionUnsupportedError";
  }
}

/** 원인을 가릴 수 없는 압축 실패. 메모리 부족처럼 다시 하면 될 수 있어 재시도를 막지 않는다. */
export class MotionFailedError extends Error {
  constructor(fileName: string) {
    super(
      `압축하지 못했습니다. 지원하지 않는 형식이거나 메모리가 부족할 수 있습니다: ${fileName}`,
    );
    this.name = "MotionFailedError";
  }
}

export interface TranscodedMotion {
  kind: MotionKind;
  file: File;
  /** 첫 프레임 WebP. 만들지 못하면 `null`이고 화면은 빈 칸에 재생 표시를 그린다. */
  poster: File | null;
  width: number;
  height: number;
}

export interface TranscodeOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * 동영상이나 GIF를 MP4로 다시 인코딩한다. 인코더를 많이 쓰는 일이라 한 번에 하나씩 처리한다. 코덱
 * 라이브러리가 크므로 처음 쓸 때 불러온다.
 */
export function transcodeMotion(
  file: File,
  options: TranscodeOptions = {},
): Promise<TranscodedMotion> {
  const run = async () => {
    options.signal?.throwIfAborted();
    const { transcode } = await import("~/shared/lib/media/transcode-motion");
    return transcode(file, options);
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
