import { decompressFrame, parseGIF } from "gifuct-js";
import {
  ALL_FORMATS,
  BlobSource,
  canEncodeAudio,
  canEncodeVideo,
  CanvasSink,
  CanvasSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
} from "mediabunny";

import { compressImage } from "~/shared/lib/image/compress";
import {
  exceedsVideoEstimate,
  fitMotionSize,
  GIF_BITRATE,
  GIF_MAX_EDGE,
  MOTION_MAX_BYTES,
  MotionFailedError,
  motionKindOf,
  MotionRejectedError,
  MotionUnsupportedError,
  VIDEO_AUDIO_BITRATE,
  VIDEO_BITRATE,
  VIDEO_MAX_EDGE,
  VIDEO_MAX_FRAME_RATE,
  type MotionKind,
  type TranscodedMotion,
  type TranscodeOptions,
} from "~/shared/lib/media/motion-policy";

/** 사진 입력과 같은 상한. 캔버스 하나가 이 화면을 통째로 잡는다. */
const GIF_MAX_PIXELS = 50_000_000;

function tooLargeMessage(kind: MotionKind, fileName: string): string {
  const limit = MOTION_MAX_BYTES[kind] / (1024 * 1024);
  const label = kind === "gif" ? "GIF" : "동영상";
  return `압축한 ${label} 크기가 ${limit}MB를 넘어 첨부할 수 없습니다: ${fileName}`;
}

function outputName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "").slice(0, 250) || "video";
  return `${stem}.mp4`;
}

/**
 * 쓰인 만큼을 세면서 모으는 출력. `fastStart: "reserve"`라 파일 앞자리를 비워 두고 앞에서부터 쓰므로
 * 재생이 파일 끝을 기다리지 않고, 상한을 넘는 순간 압축을 멈출 수 있다. `in-memory`는 끝날 때까지
 * 크기를 알 수 없다. 머리말을 나중에 덮어쓰므로 한 버퍼에 자리대로 쓴다.
 */
function createSizedSink(maxBytes: number, onOverflow: () => void) {
  let bytes = new Uint8Array(1024 * 1024);
  let size = 0;
  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      const end = chunk.position + chunk.data.byteLength;
      if (end > maxBytes) {
        onOverflow();
        return;
      }
      if (end > bytes.length) {
        const grown = new Uint8Array(
          Math.min(maxBytes, Math.max(end, bytes.length * 2)),
        );
        grown.set(bytes.subarray(0, size));
        bytes = grown;
      }
      bytes.set(chunk.data, chunk.position);
      size = Math.max(size, end);
    },
  });
  return {
    writable,
    toFile(name: string) {
      return new File([bytes.subarray(0, size)], name, { type: "video/mp4" });
    },
  };
}

/** 첫 프레임을 목록용 WebP로 만든다. 실패해도 첨부는 막지 않는다. */
async function createPoster(file: File): Promise<File | null> {
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const sink = new CanvasSink(track, { poolSize: 1 });
    const frame = await sink.getCanvas(await track.getFirstTimestamp());
    if (!frame) return null;
    const { canvas } = frame;
    const blob =
      "convertToBlob" in canvas
        ? await canvas.convertToBlob({ type: "image/png" })
        : await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/png"),
          );
    if (!blob) return null;
    return await compressImage(
      new File([blob], "poster.png", { type: "image/png" }),
      "card",
    );
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

/** 브라우저에 없으면 WASM AAC 인코더를 쓴다. 인코더가 커서 소리 있는 영상을 그런 기기에서 올릴 때만 받는다. */
async function ensureAacEncoder(): Promise<boolean> {
  if (await canEncodeAudio("aac", { bitrate: VIDEO_AUDIO_BITRATE }))
    return true;
  const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
  registerAacEncoder();
  return canEncodeAudio("aac", { bitrate: VIDEO_AUDIO_BITRATE });
}

async function transcodeVideo(
  source: File,
  { signal, onProgress }: TranscodeOptions,
): Promise<TranscodedMotion> {
  const input = new Input({
    source: new BlobSource(source),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryVideoTrack().catch(() => null);
    if (!track) throw new MotionUnsupportedError(source.name);
    if (exceedsVideoEstimate(await input.computeDuration())) {
      throw new MotionRejectedError(tooLargeMessage("video", source.name));
    }
    const { width, height } = fitMotionSize(
      track.displayWidth,
      track.displayHeight,
      VIDEO_MAX_EDGE,
    );
    if (
      !(await canEncodeVideo("avc", { width, height, bitrate: VIDEO_BITRATE }))
    ) {
      throw new MotionUnsupportedError(source.name);
    }
    const audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack && !(await ensureAacEncoder())) {
      throw new MotionUnsupportedError(source.name);
    }
    const stats = await track.computePacketStats(100);

    let overflowed = false;
    let conversion: Conversion | null = null;
    const sink = createSizedSink(MOTION_MAX_BYTES.video, () => {
      overflowed = true;
      void conversion?.cancel();
    });
    conversion = await Conversion.init({
      input,
      output: new Output({
        format: new Mp4OutputFormat({ fastStart: "reserve" }),
        target: new StreamTarget(sink.writable),
      }),
      video: {
        width,
        height,
        fit: "fill",
        // 원본이 더 낮으면 그대로 둔다. 올리면 같은 프레임을 복사해 크기만 는다.
        ...(stats.averagePacketRate > VIDEO_MAX_FRAME_RATE
          ? { frameRate: VIDEO_MAX_FRAME_RATE }
          : {}),
        codec: "avc",
        bitrate: VIDEO_BITRATE,
        forceTranscode: true,
        // 회전 메타데이터에 맡기면 저장한 치수와 화면 치수가 갈린다.
        allowTransformationMetadata: false,
      },
      audio: {
        codec: "aac",
        bitrate: VIDEO_AUDIO_BITRATE,
        forceTranscode: true,
      },
      // 기본값은 원본의 태그를 복사한다. 위치와 기기 정보를 남기지 않는다(기능 명세 §18.1).
      tags: {},
    });
    const utilized = conversion.utilizedTracks;
    if (
      !utilized.includes(track) ||
      (audioTrack && !utilized.includes(audioTrack))
    ) {
      throw new MotionUnsupportedError(source.name);
    }
    if (onProgress) conversion.onProgress = onProgress;
    const active = conversion;
    const abort = () => void active.cancel();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      // 위의 준비 단계는 오래 걸릴 수 있고, 그동안 온 취소는 이 리스너가 듣지 못한다.
      signal?.throwIfAborted();
      await conversion.execute();
      signal?.throwIfAborted();
    } catch (cause) {
      if (overflowed)
        throw new MotionRejectedError(tooLargeMessage("video", source.name));
      signal?.throwIfAborted();
      throw cause;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    if (overflowed)
      throw new MotionRejectedError(tooLargeMessage("video", source.name));

    const file = sink.toFile(outputName(source.name));
    return {
      kind: "video",
      file,
      poster: await createPoster(file),
      width,
      height,
    };
  } finally {
    input.dispose();
  }
}

async function transcodeGif(
  source: File,
  { signal, onProgress }: TranscodeOptions,
): Promise<TranscodedMotion> {
  const buffer = await source.arrayBuffer();
  const gif = (() => {
    try {
      return parseGIF(buffer);
    } catch {
      throw new MotionRejectedError(`GIF를 읽지 못했습니다: ${source.name}`);
    }
  })();
  // 프레임을 한꺼번에 풀면 30MB GIF도 수 GB의 RGBA가 되어 휴대폰 탭이 죽는다. 그릴 때 하나씩 푼다.
  const frames = gif.frames.filter(
    (frame): frame is Extract<typeof frame, { image: unknown }> =>
      "image" in frame,
  );
  if (frames.length === 0) {
    throw new MotionRejectedError(`GIF를 읽지 못했습니다: ${source.name}`);
  }
  const { width: sourceWidth, height: sourceHeight } = gif.lsd;
  if (sourceWidth * sourceHeight > GIF_MAX_PIXELS) {
    throw new MotionRejectedError(
      `GIF 해상도가 너무 커 첨부할 수 없습니다: ${source.name}`,
    );
  }
  const { width, height } = fitMotionSize(
    sourceWidth,
    sourceHeight,
    GIF_MAX_EDGE,
  );
  if (!(await canEncodeVideo("avc", { width, height, bitrate: GIF_BITRATE }))) {
    throw new MotionUnsupportedError(source.name);
  }

  // 조각을 겹쳐 그릴 전체 화면, 조각 하나, 인코더가 읽을 줄인 화면이다.
  const composed = document.createElement("canvas");
  composed.width = sourceWidth;
  composed.height = sourceHeight;
  const composedContext = composed.getContext("2d");
  const patchCanvas = document.createElement("canvas");
  const patchContext = patchCanvas.getContext("2d");
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputContext = output.getContext("2d");
  if (!composedContext || !patchContext || !outputContext) {
    throw new MotionUnsupportedError(source.name);
  }

  let overflowed = false;
  const sink = createSizedSink(MOTION_MAX_BYTES.gif, () => {
    overflowed = true;
  });
  const target = new Output({
    format: new Mp4OutputFormat({ fastStart: "reserve" }),
    target: new StreamTarget(sink.writable),
  });
  const videoSource = new CanvasSource(output, {
    codec: "avc",
    bitrate: GIF_BITRATE,
  });
  target.addVideoTrack(videoSource, { maximumPacketCount: frames.length });
  await target.start();

  try {
    let timestamp = 0;
    for (const [index, parsed] of frames.entries()) {
      if (signal?.aborted || overflowed) break;
      const frame = decompressFrame(parsed, gif.gct, true);
      const { left, top, width: patchWidth, height: patchHeight } = frame.dims;
      const before =
        frame.disposalType === 3
          ? composedContext.getImageData(0, 0, sourceWidth, sourceHeight)
          : null;
      // 크기를 대입하면 값이 같아도 캔버스를 새로 잡는다.
      if (patchCanvas.width !== patchWidth) patchCanvas.width = patchWidth;
      if (patchCanvas.height !== patchHeight) patchCanvas.height = patchHeight;
      patchContext.putImageData(
        new ImageData(
          new Uint8ClampedArray(frame.patch),
          patchWidth,
          patchHeight,
        ),
        0,
        0,
      );
      composedContext.drawImage(patchCanvas, left, top);

      // MP4에는 투명이 없다. GIF의 투명한 자리는 밝은 화면과 어울리는 흰색으로 둔다.
      outputContext.fillStyle = "#fff";
      outputContext.fillRect(0, 0, width, height);
      outputContext.drawImage(composed, 0, 0, width, height);
      // 브라우저는 0.01초 이하의 지연을 0.1초로 재생한다. 그대로 쓰면 원본보다 10배 빠르다.
      const duration = (frame.delay > 10 ? frame.delay : 100) / 1000;
      await videoSource.add(timestamp, duration);
      timestamp += duration;
      onProgress?.((index + 1) / frames.length);

      if (frame.disposalType === 2) {
        composedContext.clearRect(left, top, patchWidth, patchHeight);
      } else if (before) {
        composedContext.putImageData(before, 0, 0);
      }
    }
    if (signal?.aborted || overflowed) {
      await target.cancel();
      signal?.throwIfAborted();
      throw new MotionRejectedError(tooLargeMessage("gif", source.name));
    }
    await target.finalize();
    if (overflowed)
      throw new MotionRejectedError(tooLargeMessage("gif", source.name));
  } catch (cause) {
    if (target.state !== "canceled" && target.state !== "finalized") {
      await target.cancel().catch(() => undefined);
    }
    throw cause;
  }

  const file = sink.toFile(outputName(source.name));
  return {
    kind: "gif",
    file,
    poster: await createPoster(file),
    width,
    height,
  };
}

export async function transcode(
  source: File,
  options: TranscodeOptions,
): Promise<TranscodedMotion> {
  // WebCodecs가 없는 브라우저에서는 라이브러리가 인코더 이름도 찾지 못한다.
  if (typeof VideoEncoder === "undefined") {
    throw new MotionUnsupportedError(source.name);
  }
  try {
    return await (motionKindOf(source) === "gif"
      ? transcodeGif(source, options)
      : transcodeVideo(source, options));
  } catch (cause) {
    options.signal?.throwIfAborted();
    if (cause instanceof MotionRejectedError) throw cause;
    // HEVC처럼 기기가 풀지 못하는 코덱과 메모리 부족은 같은 라이브러리 오류로 드러나 가릴 수 없다.
    console.error(cause);
    throw new MotionFailedError(source.name);
  }
}
