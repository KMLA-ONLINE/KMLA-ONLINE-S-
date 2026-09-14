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
 * 브라우저에서만 내려받도록 지연 로드한다.
 */

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
async function encodeWithWasm(
  image: ImageData,
  quality: number,
): Promise<Blob> {
  const { default: encode } = await import("@jsquash/webp/encode");
  const encoded = await encode(image, { quality: Math.round(quality * 100) });
  return new Blob([encoded], { type: "image/webp" });
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
