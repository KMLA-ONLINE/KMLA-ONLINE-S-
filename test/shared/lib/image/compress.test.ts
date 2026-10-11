import { heicTo } from "heic-to/csp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  compressImage,
  getImageDimensions,
  isSupportedImageInput,
  prepareImageInput,
  validateImageInput,
} from "~/shared/lib/image/compress";
import { encodeWebp } from "~/shared/lib/image/encode-webp";

vi.mock("~/shared/lib/image/encode-webp", () => ({ encodeWebp: vi.fn() }));
vi.mock("heic-to/csp", () => ({ heicTo: vi.fn() }));

const encode = vi.mocked(encodeWebp);
const convertHeic = vi.mocked(heicTo);

/** 압축 경로는 원본을 디코딩해 치수를 읽는다. 테스트는 그 치수만 정해 주면 된다. */
function stubDecoder(width: number, height: number) {
  const close = vi.fn();
  const decode = vi.fn(() => Promise.resolve({ width, height, close }));
  vi.stubGlobal("createImageBitmap", decode);
  return { decode, close };
}

function webpBytes(size: number) {
  const blob = new Blob([new Uint8Array(1)], { type: "image/webp" });
  Object.defineProperty(blob, "size", { value: size });
  return blob;
}

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

function heifWithDimensions(width: number, height: number) {
  const bytes = new Uint8Array(40);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 20);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  bytes.set(new TextEncoder().encode("heic"), 8);
  bytes.set(new TextEncoder().encode("heic"), 16);
  view.setUint32(20, 20);
  bytes.set(new TextEncoder().encode("ispe"), 24);
  view.setUint32(32, width);
  view.setUint32(36, height);
  return new File([bytes], "photo.heic", { type: "image/heic" });
}

describe("compressImage", () => {
  beforeEach(() => {
    encode.mockReset();
    encode.mockResolvedValue(webpBytes(1024));
    convertHeic.mockReset();
    stubDecoder(1920, 1080);
  });

  it("HEIC와 HEIF MIME 또는 확장자를 이미지 입력으로 분류한다", () => {
    expect(
      isSupportedImageInput(
        new File(["image"], "photo.bin", { type: "image/heif" }),
      ),
    ).toBe(true);
    expect(
      isSupportedImageInput(
        new File(["image"], "photo.HEIC", {
          type: "application/octet-stream",
        }),
      ),
    ).toBe(true);
  });

  it("크롭에 넘길 HEIC는 PNG 중간본으로 디코딩한다", async () => {
    const png = pngWithDimensions(1920, 1080);
    convertHeic.mockResolvedValue(png);

    const prepared = await prepareImageInput(heifWithDimensions(1920, 1080));

    expect(prepared.type).toBe("image/png");
    expect(prepared.name).toBe("photo.png");
    expect(convertHeic).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/png" }),
    );
  });

  it("업로드하는 HEIC는 전체 해상도 PNG를 거치지 않고 곧바로 픽셀로 받는다", async () => {
    // PNG 왕복은 12메가픽셀 사진에서 40MB가 넘었고, iOS에서 메모리 상한에 먼저 닿았다.
    const heic = heifWithDimensions(1920, 1080);
    const close = vi.fn();
    convertHeic.mockResolvedValue({
      width: 1920,
      height: 1080,
      close,
    } as unknown as Blob);
    const { decode } = stubDecoder(1920, 1080);

    const result = await compressImage(heic, "photo");

    expect(convertHeic).toHaveBeenCalledWith({
      blob: heic,
      type: "bitmap",
      options: { imageOrientation: "from-image" },
    });
    expect(decode).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(result.type).toBe("image/webp");
  });

  it("50메가픽셀을 넘는 HEIF는 디코더를 불러 처리하기 전에 거절한다", async () => {
    await expect(
      prepareImageInput(heifWithDimensions(10_000, 5_001)),
    ).rejects.toThrow("50메가픽셀");
    expect(convertHeic).not.toHaveBeenCalled();
  });

  it("비이미지는 인코더를 부르지 않고 원본을 반환한다", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "report.pdf", {
      type: "application/pdf",
    });

    await expect(compressImage(file, "icon")).resolves.toBe(file);
    expect(encode).not.toHaveBeenCalled();
  });

  it("프리셋의 치수·품질로 한 번 인코딩하고 WebP File로 정규화한다", async () => {
    // 헤더가 읽히는 PNG라 입력 검사는 디코딩하지 않는다. 디코딩은 인코딩 경로 한 번뿐이다.
    const file = pngWithDimensions(2048, 1024, "avatar.png");
    const { close } = stubDecoder(2048, 1024);

    const result = await compressImage(file, "icon");

    expect(encode).toHaveBeenCalledWith(
      expect.objectContaining({ width: 2048, height: 1024 }),
      512,
      256,
      0.85,
    );
    expect(close).toHaveBeenCalledOnce();
    expect(result).not.toBe(file);
    expect(result.name).toBe("avatar.webp");
    expect(result.type).toBe("image/webp");
  });

  it("프리셋마다 다른 치수를 쓴다", async () => {
    const file = new File([new Uint8Array(100)], "photo.jpg", {
      type: "image/jpeg",
    });
    stubDecoder(6000, 4000);

    await compressImage(file, "photo");
    expect(encode).toHaveBeenLastCalledWith(
      expect.anything(),
      3072,
      2048,
      0.85,
    );

    await compressImage(file, "banner");
    expect(encode).toHaveBeenLastCalledWith(
      expect.anything(),
      2400,
      1600,
      0.85,
    );
  });

  it("원본이 프리셋보다 작으면 키우지 않는다", async () => {
    const file = new File([new Uint8Array(100)], "photo.jpg", {
      type: "image/jpeg",
    });
    stubDecoder(320, 240);

    await compressImage(file, "photo");

    expect(encode).toHaveBeenLastCalledWith(expect.anything(), 320, 240, 0.85);
  });

  it("결과가 원본보다 커도 재인코딩한 쪽을 준다", async () => {
    // 원본을 통과시키면 EXIF 제거·포맷 통일 보장이 조용히 깨진다. 몇 KB 손해가 낫다.
    const file = new File([new Uint8Array(20)], "small.png", {
      type: "image/png",
    });
    encode.mockResolvedValue(webpBytes(400));

    const result = await compressImage(file, "icon");

    expect(result).not.toBe(file);
    expect(result.type).toBe("image/webp");
  });

  it("이미지 재인코딩에 실패하면 원본을 통과시키지 않고 던진다", async () => {
    const file = new File([new Uint8Array(20)], "broken.png", {
      type: "image/png",
    });
    encode.mockRejectedValue(new Error("canvas unavailable"));

    await expect(compressImage(file, "icon")).rejects.toThrow("broken.png");
  });

  it("크롭하기 전에 50메가픽셀을 넘는 원본을 거절한다", async () => {
    const { close } = stubDecoder(10_000, 5_001);
    const file = new File([new Uint8Array(20)], "large.png", {
      type: "image/png",
    });

    await expect(validateImageInput(file)).rejects.toThrow("50메가픽셀");
    expect(close).toHaveBeenCalledOnce();
    expect(encode).not.toHaveBeenCalled();
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

  it("WebP 결과의 치수는 헤더만 읽고 다시 디코딩하지 않는다", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);

    await expect(
      getImageDimensions(webpWithDimensions(1920, 1080)),
    ).resolves.toEqual([1920, 1080]);

    expect(decode).not.toHaveBeenCalled();
  });

  it("입력 치수 검사는 파일 전체 대신 앞부분만 읽는다", async () => {
    const bytes = new Uint8Array(512 * 1024);
    bytes.set(new Uint8Array(await pngWithDimensions(10, 10).arrayBuffer()));
    const file = new File([bytes], "photo.png", { type: "image/png" });
    const slice = vi.spyOn(file, "slice");

    await expect(validateImageInput(file)).resolves.toBeUndefined();

    expect(slice).toHaveBeenCalledWith(0, 256 * 1024);
  });

  it("30 MB를 넘는 입력은 헤더를 읽기 전에 거절한다", async () => {
    const file = pngWithDimensions(10, 10, "large.png");
    Object.defineProperty(file, "size", { value: 30 * 1024 * 1024 + 1 });

    await expect(validateImageInput(file)).rejects.toThrow(
      "이미지는 30MB 이하여야 합니다",
    );
  });

  it("디코딩한 뒤에야 드러난 치수 초과도 그대로 알린다", async () => {
    // `ispe` 박스가 없는 HEIF는 헤더만 보고 거를 수 없다.
    const heic = heifWithDimensions(10, 10);
    convertHeic.mockResolvedValue({
      width: 10_000,
      height: 5_001,
      close: vi.fn(),
    } as unknown as Blob);

    await expect(compressImage(heic, "photo")).rejects.toThrow("50메가픽셀");
  });

  it("처리 결과가 사진의 8 MiB 상한을 넘으면 거절한다", async () => {
    const file = pngWithDimensions(10, 10);
    encode.mockResolvedValue(webpBytes(8 * 1024 * 1024 + 1));

    await expect(compressImage(file, "photo")).rejects.toThrow(
      "처리한 이미지가 용량 제한을 초과합니다",
    );
  });
});
