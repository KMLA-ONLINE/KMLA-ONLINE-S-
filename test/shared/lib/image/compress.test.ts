import imageCompression from "browser-image-compression";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { compressImage, validateImageInput } from "~/shared/lib/image/compress";

vi.mock("browser-image-compression", () => ({ default: vi.fn() }));

const compress = vi.mocked(imageCompression);

function pngWithDimensions(width: number, height: number, name = "photo.png") {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x89504e47);
  view.setUint32(4, 0x0d0a1a0a);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new File([bytes], name, { type: "image/png" });
}

function jpegWithDimensions(width: number, height: number) {
  const bytes = new Uint8Array(21);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xffd8);
  view.setUint16(2, 0xffc0);
  view.setUint16(4, 17);
  view.setUint8(6, 8);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return new File([bytes], "photo.jpg", { type: "image/jpeg" });
}

function webpWithDimensions(width: number, height: number) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x52494646);
  view.setUint32(4, 22, true);
  view.setUint32(8, 0x57454250);
  view.setUint32(12, 0x56503858);
  view.setUint32(16, 10, true);
  for (let index = 0; index < 3; index += 1) {
    view.setUint8(24 + index, ((width - 1) >> (index * 8)) & 0xff);
    view.setUint8(27 + index, ((height - 1) >> (index * 8)) & 0xff);
  }
  return new File([bytes], "photo.webp", { type: "image/webp" });
}

describe("compressImage", () => {
  beforeEach(() => {
    compress.mockReset();
  });

  it("비이미지는 압축 라이브러리를 부르지 않고 원본을 반환한다", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "report.pdf", {
      type: "application/pdf",
    });

    await expect(compressImage(file, "icon")).resolves.toBe(file);
    expect(compress).not.toHaveBeenCalled();
  });

  it("프리셋의 치수·품질로 한 번 압축하고 WebP File로 정규화한다", async () => {
    const file = new File([new Uint8Array(100)], "avatar.png", {
      type: "image/png",
    });
    compress.mockResolvedValue(
      new File([new Uint8Array(20)], "avatar.png", { type: "image/png" }),
    );

    const result = await compressImage(file, "icon");

    expect(compress).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        maxWidthOrHeight: 512,
        initialQuality: 0.85,
        fileType: "image/webp",
        preserveExif: false,
        alwaysKeepResolution: false,
      }),
    );
    expect(result).not.toBe(file);
    expect(result.name).toBe("avatar.webp");
    expect(result.type).toBe("image/webp");
  });

  it("프리셋마다 다른 치수를 쓴다", async () => {
    const file = new File([new Uint8Array(100)], "photo.jpg", {
      type: "image/jpeg",
    });
    compress.mockResolvedValue(new File([new Uint8Array(10)], "photo.webp"));

    await compressImage(file, "photo");
    expect(compress).toHaveBeenLastCalledWith(
      file,
      expect.objectContaining({ maxWidthOrHeight: 3072, initialQuality: 0.85 }),
    );

    await compressImage(file, "banner");
    expect(compress).toHaveBeenLastCalledWith(
      file,
      expect.objectContaining({ maxWidthOrHeight: 2400, initialQuality: 0.85 }),
    );
  });

  it("워커 라이브러리를 외부 CDN이 아니라 같은 출처에서 불러온다", async () => {
    const file = new File([new Uint8Array(100)], "photo.jpg", {
      type: "image/jpeg",
    });
    compress.mockResolvedValue(new File([new Uint8Array(10)], "photo.webp"));

    await compressImage(file, "photo");

    const options = compress.mock.calls[0][1];
    expect(options?.useWebWorker).toBe(true);
    expect(options?.libURL).toBeTruthy();
    expect(options?.libURL).not.toMatch(/^https?:\/\//);
  });

  it("결과가 원본보다 커도 재인코딩한 쪽을 준다", async () => {
    // 원본을 통과시키면 EXIF 제거·포맷 통일 보장이 조용히 깨진다. 몇 KB 손해가 낫다.
    const file = new File([new Uint8Array(20)], "small.png", {
      type: "image/png",
    });
    compress.mockResolvedValue(new File([new Uint8Array(400)], "small.webp"));

    const result = await compressImage(file, "icon");

    expect(result).not.toBe(file);
    expect(result.type).toBe("image/webp");
  });

  it("이미지 재인코딩에 실패하면 원본을 통과시키지 않고 던진다", async () => {
    const file = new File([new Uint8Array(20)], "broken.png", {
      type: "image/png",
    });
    compress.mockRejectedValue(new Error("canvas unavailable"));

    await expect(compressImage(file, "icon")).rejects.toThrow("broken.png");
  });

  it("크롭하기 전에 50메가픽셀을 넘는 원본을 거절한다", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve({ width: 10_000, height: 5_001, close })),
    );
    const file = new File([new Uint8Array(20)], "large.png", {
      type: "image/png",
    });

    await expect(validateImageInput(file)).rejects.toThrow("50메가픽셀");
    expect(close).toHaveBeenCalledOnce();
    expect(compress).not.toHaveBeenCalled();
  });

  it.each([
    ["PNG", pngWithDimensions(10_000, 5_001)],
    ["JPEG", jpegWithDimensions(10_000, 5_001)],
    ["WebP", webpWithDimensions(10_000, 5_001)],
  ])(
    "%s 헤더에서 치수를 읽어 전체 디코딩 전에 거절한다",
    async (_type, file) => {
      const decode = vi.fn();
      vi.stubGlobal("createImageBitmap", decode);

      await expect(validateImageInput(file)).rejects.toThrow("50메가픽셀");
      expect(decode).not.toHaveBeenCalled();
    },
  );

  it("30 MB를 넘는 입력은 헤더를 읽기 전에 거절한다", async () => {
    const file = pngWithDimensions(10, 10, "large.png");
    Object.defineProperty(file, "size", { value: 30 * 1024 * 1024 + 1 });

    await expect(validateImageInput(file)).rejects.toThrow(
      "이미지는 30MB 이하여야 합니다",
    );
  });

  it("처리 결과가 사진의 8 MiB 상한을 넘으면 거절한다", async () => {
    const file = pngWithDimensions(10, 10);
    const result = new File(["result"], "photo.webp", {
      type: "image/webp",
    });
    Object.defineProperty(result, "size", { value: 8 * 1024 * 1024 + 1 });
    compress.mockResolvedValue(result);

    await expect(compressImage(file, "photo")).rejects.toThrow(
      "처리한 이미지가 용량 제한을 초과합니다",
    );
  });
});
