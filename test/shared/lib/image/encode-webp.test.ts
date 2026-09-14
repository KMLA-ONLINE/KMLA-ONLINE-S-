import { afterEach, describe, expect, it, vi } from "vitest";

const encodeWithWasm = vi.fn(() =>
  Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer),
);

vi.mock("@jsquash/webp/encode", () => ({ default: encodeWithWasm }));

/**
 * `nativeWebp: false`가 WebKit이다. 지원하지 않는 타입을 요청받은 캔버스는 예외 대신 PNG를
 * 돌려주므로, 가짜 캔버스도 같은 방식으로 거짓말한다.
 *
 * `blobIsWebp`를 따로 주면 감지(`toDataURL`)와 인코딩(`toBlob`)의 답이 엇갈리는 브라우저가
 * 된다. 둘은 실제로 다른 경로라 엇갈릴 수 있고, 그때도 결과는 WebP여야 한다.
 */
function stubCanvas(nativeWebp: boolean, blobIsWebp = nativeWebp) {
  const drawImage = vi.fn();
  const getImageData = vi.fn(() => ({
    data: new Uint8ClampedArray(4),
    width: 1,
    height: 1,
  }));
  const toBlob = vi.fn(
    (callback: (blob: Blob) => void, type: string, quality: number) => {
      void quality;
      callback(
        new Blob([new Uint8Array(2)], {
          type: blobIsWebp ? type : "image/png",
        }),
      );
    },
  );
  // 능력 확인용 1×1 캔버스와 실제로 그리는 캔버스는 별개다. 스텁도 매번 새로 만든다.
  const canvases: { width: number; height: number }[] = [];
  const createElement = () => {
    const canvas = {
      width: 0,
      height: 0,
      toDataURL: (type: string) =>
        nativeWebp && type === "image/webp"
          ? "data:image/webp;base64,AA"
          : "data:image/png;base64,AA",
      toBlob,
      getContext: () => ({
        drawImage,
        getImageData,
        imageSmoothingQuality: "",
      }),
    };
    canvases.push(canvas);
    return canvas;
  };

  vi.stubGlobal("document", { createElement });
  return { canvases, drawImage, toBlob };
}

/** 모듈이 브라우저 능력을 한 번만 확인하고 기억하므로, 사례마다 새로 불러온다. */
async function loadEncoder() {
  vi.resetModules();
  return (await import("~/shared/lib/image/encode-webp")).encodeWebp;
}

const bitmap = { width: 4000, height: 3000 } as unknown as ImageBitmap;

afterEach(() => {
  encodeWithWasm.mockClear();
  vi.unstubAllGlobals();
});

describe("encodeWebp", () => {
  it("캔버스가 WebP를 인코딩할 수 있으면 WASM을 부르지 않는다", async () => {
    const { canvases, drawImage } = stubCanvas(true);
    const encodeWebp = await loadEncoder();

    const blob = await encodeWebp(bitmap, 3072, 2304, 0.85);

    expect(blob.type).toBe("image/webp");
    expect(canvases[0]).toMatchObject({ width: 3072, height: 2304 });
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 3072, 2304);
    expect(encodeWithWasm).not.toHaveBeenCalled();
  });

  it("캔버스가 PNG로 되돌아가면 WASM으로 인코딩해 WebP를 돌려준다", async () => {
    // WebKit에서 이 갈래가 없으면 PNG가 `image/webp` 이름표를 달고 업로드된다.
    const { toBlob } = stubCanvas(false);
    const encodeWebp = await loadEncoder();

    const blob = await encodeWebp(bitmap, 800, 600, 0.8);

    expect(blob.type).toBe("image/webp");
    expect(toBlob).not.toHaveBeenCalled();
    expect(encodeWithWasm).toHaveBeenCalledWith(expect.anything(), {
      quality: 80,
    });
  });

  it("감지를 통과해도 결과가 WebP가 아니면 WASM으로 되돌아간다", async () => {
    const { toBlob } = stubCanvas(true, false);
    const encodeWebp = await loadEncoder();

    const blob = await encodeWebp(bitmap, 800, 600, 0.85);

    expect(toBlob).toHaveBeenCalledOnce();
    expect(blob.type).toBe("image/webp");
    expect(encodeWithWasm).toHaveBeenCalledOnce();
  });
});
