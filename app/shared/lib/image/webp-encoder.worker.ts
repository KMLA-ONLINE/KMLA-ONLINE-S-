/**
 * libwebp(WASM) 인코딩만 담당하는 워커.
 *
 * 인코딩은 동기 호출이라 메인 스레드에서 돌리면 그 시간 동안 화면이 통째로 멈춘다. 3072px
 * 사진 한 장이 수백 ms에서 1초 남짓이고, 그 사이 스크롤도 탭도 먹지 않는다. 캔버스 작업은
 * 메인 스레드에 남기고 이 단계만 떼어 낸다.
 *
 * 픽셀은 `ArrayBuffer`로 주고받으며 양쪽 모두 transfer한다. 3072×2304 한 장이 28MB라
 * 복사하면 그만큼이 두 번 잡힌다.
 */
import encode from "@jsquash/webp/encode";

interface EncodeRequest {
  id: number;
  pixels: ArrayBuffer;
  width: number;
  height: number;
  /** libwebp 단위(0~100). 캔버스 단위 변환은 호출부가 끝내고 보낸다. */
  quality: number;
}

type EncodeResponse =
  { id: number; encoded: ArrayBuffer } | { id: number; error: string };

/**
 * `lib.webworker`가 켜져 있지 않아 `DedicatedWorkerGlobalScope`를 쓸 수 없다. DOM의 `self`는
 * `postMessage` 서명이 달라서, 실제로 쓰는 두 가지만 좁혀 둔다.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<EncodeRequest>) => void) | null;
  postMessage: (message: EncodeResponse, transfer?: Transferable[]) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, pixels, width, height, quality } = event.data;
  void (async () => {
    try {
      const image = new ImageData(new Uint8ClampedArray(pixels), width, height);
      const encoded = await encode(image, { quality });
      scope.postMessage({ id, encoded }, [encoded]);
    } catch (cause) {
      scope.postMessage({
        id,
        error: cause instanceof Error ? cause.message : "webp encode failed",
      });
    }
  })();
};
