/**
 * 캔버스 픽셀을 WebP 바이트로 바꾸는 한 곳. 인코더는 브라우저 능력에 따라 갈린다.
 *
 * WebKit(Safari와 iOS의 모든 브라우저)에는 캔버스 WebP 인코더가 없다. 문제는 없다는 사실이
 * 아니라 없다는 걸 알리는 방식이다. `toBlob`과 `toDataURL`은 지원하지 않는 타입을 요청받으면
 * 예외를 던지거나 null을 주는 대신 **조용히 PNG를 돌려준다**. HTML 스펙이 그렇게 정해 뒀다.
 *
 * 그래서 결과 MIME을 확인하지 않으면 PNG가 `image/webp` 이름표를 달고 Storage까지 올라가고,
 * 같은 사진이 3~5배로 불어나 프리셋의 `maxBytes`에 걸린다. iOS에서 사진 업로드가 "처리한
 * 이미지가 용량 제한을 초과합니다"로 끝나던 원인이 이것이다.
 *
 * 네이티브가 WebP를 내놓지 못하면 libwebp(WASM)로 직접 인코딩한다. 이 갈래는 WASM이 필요한
 * 브라우저에서만 내려받도록 지연 로드하고, 인코딩 자체는 워커에서 돌린다 — 동기 호출이라
 * 메인 스레드에 두면 그 시간 동안 화면이 멈춘다. 파일 앞쪽 절반이 그 워커를 다루는 배관이다.
 */

/**
 * 마지막 인코딩에서 이만큼 지나면 워커를 접는다.
 *
 * 살려 두면 다음 사진에서 libwebp를 다시 세우지 않아 이득이지만, 그 대가로 WASM 힙이 계속
 * 잡혀 있다. 업로드를 끝내고 피드로 돌아간 사용자에게 수십 MB를 물려 둘 이유는 없다 — iOS는
 * 메모리 압박에서 탭을 죽이고, 그건 느린 것보다 나쁘다. 연속 업로드는 이 시간 안에 들어온다.
 */
const WORKER_IDLE_TIMEOUT_MS = 30_000;

interface PendingEncode {
  resolve: (blob: Blob) => void;
  reject: (reason: unknown) => void;
}

let worker: Worker | null | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let nextRequestId = 0;
const pending = new Map<number, PendingEncode>();

function disposeWorker(reason?: Error): void {
  worker?.terminate();
  // `null`은 "이 세션에서는 워커를 쓰지 않는다", `undefined`는 "아직 안 만들었다"를 뜻한다.
  worker = reason ? null : undefined;
  if (!reason) return;
  pending.forEach((request) => request.reject(reason));
  pending.clear();
}

function scheduleIdleDisposal(): void {
  clearTimeout(idleTimer);
  if (pending.size > 0 || !worker) return;
  idleTimer = setTimeout(() => disposeWorker(), WORKER_IDLE_TIMEOUT_MS);
}

function encoderWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker !== "function") return (worker = null);

  try {
    worker = new Worker(new URL("./webp-encoder.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return (worker = null);
  }

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id);
    pending.delete(event.data.id);
    if ("error" in event.data) request?.reject(new Error(event.data.error));
    else
      request?.resolve(new Blob([event.data.encoded], { type: "image/webp" }));
    scheduleIdleDisposal();
  };
  // 워커가 통째로 죽으면 남은 요청은 영영 답을 받지 못한다. 여기서 끊고, 이후로는 인라인으로
  // 내려간다 — 한 번 세우지 못한 워커가 다음에 세워질 이유가 없다.
  worker.onerror = () => disposeWorker(new Error("webp encoder worker failed"));
  return worker;
}

type WorkerResponse =
  { id: number; encoded: ArrayBuffer } | { id: number; error: string };

/** 워커가 인코딩하면 그 결과를, 워커를 쓸 수 없으면 `null`을 준다. */
function encodeOnWorker(
  image: ImageData,
  quality: number,
): Promise<Blob | null> {
  const target = encoderWorker();
  if (!target) return Promise.resolve(null);

  clearTimeout(idleTimer);
  const id = (nextRequestId += 1);
  const promise = new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  // `image.data`는 `getImageData()`가 막 만들어 준 사본이라 넘겨도 잃을 것이 없다. 다만 넘긴
  // 뒤에는 이쪽 버퍼가 비므로, 워커가 도중에 죽으면 이 사진은 인라인으로 되돌릴 수 없고
  // 그대로 실패한다. 다음 사진부터는 인라인으로 내려가고, 실패한 사진은 재시도로 다시 푼다.
  const pixels = image.data.buffer;
  target.postMessage(
    {
      id,
      pixels,
      width: image.width,
      height: image.height,
      quality: toLibwebpQuality(quality),
    },
    [pixels],
  );
  return promise;
}

let nativeEncoder: boolean | undefined;

function hasNativeWebpEncoder(): boolean {
  if (nativeEncoder === undefined) {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    nativeEncoder = probe.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return nativeEncoder;
}

/**
 * 캔버스가 실제로 WebP를 내놓았을 때만 그 Blob을 준다. 아니면 `null`.
 *
 * 감지를 통과했어도 결과를 다시 확인하는 이유는, `toDataURL`(감지)과 `toBlob`(인코딩)이
 * 브라우저 안에서 서로 다른 경로이고 이 API가 실패를 알리는 방식이 바로 조용한 PNG 대체이기
 * 때문이다. 확인하지 않으면 무엇이 돌아왔는지 알 방법이 없다.
 */
async function encodeWithCanvas(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", quality);
  });
  return blob?.type === "image/webp" ? blob : null;
}

/** libwebp의 품질은 0~100이고, 캔버스 API는 0~1이다. 호출부는 캔버스 쪽 단위로 말한다. */
function toLibwebpQuality(quality: number): number {
  return Math.round(quality * 100);
}

/**
 * 워커를 못 쓸 때 쓰는 갈래. 인코딩이 동기라 그동안 화면이 멈춘다.
 *
 * 워커 생성이 막히거나(구형 브라우저, 일부 내장 웹뷰) 워커가 죽어도 업로드는 되어야 한다.
 * 느린 것과 안 되는 것은 다르다.
 */
async function encodeInline(image: ImageData, quality: number): Promise<Blob> {
  const { default: encode } = await import("@jsquash/webp/encode");
  const encoded = await encode(image, { quality: toLibwebpQuality(quality) });
  return new Blob([encoded], { type: "image/webp" });
}

async function encodeWithWasm(
  image: ImageData,
  quality: number,
): Promise<Blob> {
  const encoded = await encodeOnWorker(image, quality);
  return encoded ?? encodeInline(image, quality);
}

/**
 * 디코딩한 이미지를 `width`×`height`로 줄여 WebP로 인코딩한다.
 *
 * 축소를 원본 크기의 중간 캔버스 없이 `drawImage` 한 번으로 끝내는 게 중요하다. iOS의 캔버스
 * 한 장은 4096×4096(16.7메가픽셀)을 넘길 수 없어서, 원본을 제 크기로 캔버스에 올리려 들면
 * 요즘 휴대폰 사진에서 바로 걸린다. 여기서 만드는 캔버스는 프리셋의 `maxEdge` 이하다.
 */
export async function encodeWebp(
  source: ImageBitmap,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);

  if (hasNativeWebpEncoder()) {
    const blob = await encodeWithCanvas(canvas, quality);
    if (blob) return blob;
    // 감지는 된다고 했는데 결과가 아니었다. 이 세션에서는 다시 묻지 않는다.
    nativeEncoder = false;
  }

  return encodeWithWasm(ctx.getImageData(0, 0, width, height), quality);
}
