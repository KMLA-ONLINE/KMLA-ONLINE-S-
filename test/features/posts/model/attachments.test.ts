import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  imageDownloadName,
  prepareCommentImage,
  preparePostFiles,
  splitPostAttachments,
  toAttachmentDownloadUrl,
} from "~/features/posts/model/attachments";
import type {
  PostAttachment,
  PreparedPostFile,
} from "~/features/posts/model/types";
import { compressImage, getImageDimensions } from "~/shared/lib/image/compress";

vi.mock("~/shared/lib/image/compress", () => ({
  compressImage: vi.fn(),
  getImageDimensions: vi.fn(),
  isSupportedImageInput: (file: File) =>
    [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ].includes(file.type) || /\.(?:jpe?g|png|webp|heic|heif)$/i.test(file.name),
}));

const compress = vi.mocked(compressImage);
const getDimensions = vi.mocked(getImageDimensions);

beforeEach(() => {
  compress.mockReset();
  getDimensions.mockResolvedValue([20, 10]);
});

describe("imageDownloadName", () => {
  it("uses the stable image UUID instead of an original filename", () => {
    expect(imageDownloadName("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000.webp",
    );
  });
});

describe("toAttachmentDownloadUrl", () => {
  it("keeps the signing token and adds the download filename", () => {
    const url = new URL(
      toAttachmentDownloadUrl(
        "https://project.supabase.co/storage/v1/object/sign/post-attachments/p/a.pdf?token=abc",
        "보고서.pdf",
      ),
    );

    expect(url.searchParams.get("token")).toBe("abc");
    expect(url.searchParams.get("download")).toBe("보고서.pdf");
  });

  it("does not stack up on a URL that already carries one", () => {
    const once = toAttachmentDownloadUrl(
      "https://project.supabase.co/f.pdf?token=abc",
      "a.pdf",
    );
    const twice = toAttachmentDownloadUrl(once, "b.pdf");

    expect(new URL(twice).searchParams.getAll("download")).toEqual(["b.pdf"]);
  });
});

describe("prepareCommentImage", () => {
  it("rejects non-photo files before compression", async () => {
    await expect(
      prepareCommentImage(
        new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toThrow("JPEG, PNG, WebP");
  });

  it("rejects an image larger than 30 MB before compression", async () => {
    const file = new File(["photo"], "large.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 30 * 1024 * 1024 + 1 });

    await expect(prepareCommentImage(file)).rejects.toThrow(
      "이미지는 30MB 이하여야 합니다",
    );
    expect(compress).not.toHaveBeenCalled();
  });

  it("normalizes HEIC comment images through the shared image pipeline", async () => {
    const source = new File(["photo"], "photo.heic", { type: "image/heic" });
    const normalized = new File(["webp"], "photo.webp", {
      type: "image/webp",
    });
    compress.mockResolvedValue(normalized);

    await expect(prepareCommentImage(source)).resolves.toMatchObject({
      file: normalized,
      kind: "image",
    });
    expect(compress).toHaveBeenCalledWith(source, "photo");
  });
});

describe("preparePostFiles", () => {
  it("limits CPU-heavy photo normalization to three selected images at once", async () => {
    let active = 0;
    let maxActive = 0;
    let photoCalls = 0;
    const release: (() => void)[] = [];

    compress.mockImplementation((file, preset) => {
      if (preset === "thumbnail") return Promise.resolve(file);

      photoCalls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);

      if (photoCalls > 3) {
        active -= 1;
        return Promise.resolve(file);
      }

      return new Promise<File>((resolve) => {
        release.push(() => {
          active -= 1;
          resolve(file);
        });
      });
    });

    const preparation = preparePostFiles(
      [
        new File(["one"], "one.png", { type: "image/png" }),
        new File(["two"], "two.png", { type: "image/png" }),
        new File(["three"], "three.png", { type: "image/png" }),
      ],
      0,
      "image",
    );

    try {
      expect(active).toBeGreaterThanOrEqual(3);
      expect(maxActive).toBe(3);
    } finally {
      release.forEach((resolve) => resolve());
      await preparation;
    }
  });

  it("keeps an otherwise valid image when its optional thumbnail cannot be made", async () => {
    const normalized = new File(["photo"], "photo.webp", {
      type: "image/webp",
    });
    compress.mockImplementation((_file, preset) =>
      preset === "thumbnail"
        ? Promise.reject(new Error("thumbnail failed"))
        : Promise.resolve(normalized),
    );

    await expect(
      preparePostFiles(
        [new File(["source"], "photo.png", { type: "image/png" })],
        0,
        "image",
      ),
    ).resolves.toMatchObject([{ file: normalized, thumbnail: null }]);
  });

  it("adds the normalized photo before its optional thumbnail finishes", async () => {
    const normalized = new File(["photo"], "photo.webp", {
      type: "image/webp",
    });
    let resolveThumbnail: ((file: File) => void) | undefined;
    compress.mockImplementation((_file, preset) => {
      if (preset === "photo") return Promise.resolve(normalized);
      return new Promise<File>((resolve) => {
        resolveThumbnail = resolve;
      });
    });
    const onPrepared = vi.fn();

    const preparation = preparePostFiles(
      [new File(["source"], "photo.png", { type: "image/png" })],
      0,
      "image",
      { onPrepared },
    );

    await vi.waitFor(() => expect(onPrepared).toHaveBeenCalledOnce());
    const item = onPrepared.mock.calls[0][0] as PreparedPostFile;
    expect(item.file).toBe(normalized);
    expect(item.thumbnail).toBeNull();
    resolveThumbnail?.(normalized);
    await expect(preparation).resolves.toMatchObject([
      { file: normalized, thumbnail: normalized },
    ]);
  });

  it("normalizes two images at a time on iPad-class devices", async () => {
    vi.stubGlobal("navigator", { platform: "iPad", maxTouchPoints: 5 });
    let active = 0;
    let maxActive = 0;
    const release: (() => void)[] = [];
    compress.mockImplementation((file, preset) => {
      if (preset === "thumbnail") return Promise.resolve(file);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<File>((resolve) => {
        release.push(() => {
          active -= 1;
          resolve(file);
        });
      });
    });

    const preparation = preparePostFiles(
      [
        new File(["one"], "one.png", { type: "image/png" }),
        new File(["two"], "two.png", { type: "image/png" }),
        new File(["three"], "three.png", { type: "image/png" }),
      ],
      0,
      "image",
    );

    expect(active).toBe(2);
    release.shift()?.();
    await vi.waitFor(() => expect(active).toBe(2));
    release.forEach((resolve) => resolve());
    await preparation;
    // 데스크톱의 3보다 낮게 유지한다. iOS는 메모리 압박에서 탭을 죽인다.
    expect(maxActive).toBe(2);
    vi.unstubAllGlobals();
  });

  it("자리를 고른 순서대로 먼저 잡고 압축이 끝나는 순서에 흔들리지 않는다", async () => {
    const release = new Map<string, (file: File) => void>();
    compress.mockImplementation((file, preset) => {
      if (preset === "thumbnail") return Promise.resolve(file);
      return new Promise<File>((resolve) => release.set(file.name, resolve));
    });
    const onQueued = vi.fn();
    const onPrepared = vi.fn();
    const selected = [
      new File(["one"], "one.png", { type: "image/png" }),
      new File(["two"], "two.png", { type: "image/png" }),
      new File(["three"], "three.png", { type: "image/png" }),
    ];

    const preparation = preparePostFiles(selected, 0, "image", {
      onQueued,
      onPrepared,
    });

    // 준비가 시작되기 전에 한 번에 알려야 화면이 자리를 잡을 수 있다.
    expect(onQueued).toHaveBeenCalledOnce();
    expect(onPrepared).not.toHaveBeenCalled();
    const keys = onQueued.mock.calls[0][0] as string[];
    expect(keys).toHaveLength(3);

    // 마지막에 고른 사진이 가장 먼저 끝난다 — 큰 사진 뒤에 작은 사진을 고른 경우다.
    await vi.waitFor(() => expect(release.size).toBe(3));
    release.get("three.png")!(selected[2]);
    release.get("one.png")!(selected[0]);
    release.get("two.png")!(selected[1]);

    const prepared = await preparation;
    expect(prepared.map((item) => item.key)).toEqual(keys);
    expect(prepared.map((item) => item.file.name)).toEqual([
      "one.png",
      "two.png",
      "three.png",
    ]);
  });

  it("준비하지 못한 파일의 key를 알려 자리를 비울 수 있게 한다", async () => {
    compress.mockRejectedValue(new Error("압축 실패"));
    const onQueued = vi.fn();
    const onError = vi.fn();

    await expect(
      preparePostFiles(
        [new File(["one"], "one.png", { type: "image/png" })],
        0,
        "image",
        { onQueued, onError },
      ),
    ).rejects.toThrow("압축 실패");

    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      (onQueued.mock.calls[0][0] as string[])[0],
    );
  });
});

function attachment(overrides: Partial<PostAttachment>): PostAttachment {
  return {
    attachment_id: "attachment-id",
    created_at: "2026-08-13T00:00:00Z",
    height: null,
    mime_type: "application/pdf",
    object_path: "post-id/attachment-id",
    original_filename: "document.pdf",
    position: 0,
    post_id: "post-id",
    ready_at: "2026-08-13T00:00:00Z",
    size_bytes: 10,
    status: "ready",
    storage_bucket: "post-attachments",
    thumbnail_path: null,
    thumbnailUrl: null,
    width: null,
    signedUrl: "https://example.com/file",
    ...overrides,
  };
}

describe("splitPostAttachments", () => {
  it("treats normalized WebP as images and everything else as files", () => {
    const { images, files } = splitPostAttachments([
      attachment({
        attachment_id: "photo",
        mime_type: "image/webp",
        original_filename: "photo.webp",
      }),
      attachment({ attachment_id: "doc" }),
    ]);

    expect(images.map((item) => item.attachment_id)).toEqual(["photo"]);
    expect(files.map((item) => item.attachment_id)).toEqual(["doc"]);
  });
});
