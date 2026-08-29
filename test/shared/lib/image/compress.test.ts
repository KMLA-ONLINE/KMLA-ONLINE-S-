import imageCompression from "browser-image-compression";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { compressImage } from "~/shared/lib/image/compress";

vi.mock("browser-image-compression", () => ({ default: vi.fn() }));

const compress = vi.mocked(imageCompression);

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
        initialQuality: 0.9,
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
      expect.objectContaining({ maxWidthOrHeight: 3072, initialQuality: 0.9 }),
    );

    await compressImage(file, "banner");
    expect(compress).toHaveBeenLastCalledWith(
      file,
      expect.objectContaining({ maxWidthOrHeight: 2400, initialQuality: 0.9 }),
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
});
