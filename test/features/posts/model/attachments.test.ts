import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  imageDownloadName,
  prepareCommentImage,
  preparePostFiles,
  splitPostAttachments,
  toAttachmentDownloadUrl,
} from "~/features/posts/model/attachments";
import type { PostAttachment } from "~/features/posts/model/types";
import { compressImage } from "~/shared/lib/image/compress";

vi.mock("~/shared/lib/image/compress", () => ({
  compressImage: vi.fn(),
}));

const compress = vi.mocked(compressImage);

beforeEach(() => {
  compress.mockReset();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => Promise.resolve({ width: 20, height: 10, close: vi.fn() })),
  );
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
});

describe("preparePostFiles", () => {
  it("limits CPU-heavy photo normalization to two selected images at once", async () => {
    let active = 0;
    let maxActive = 0;
    let photoCalls = 0;
    const release: (() => void)[] = [];

    compress.mockImplementation((file, preset) => {
      if (preset === "thumbnail") return Promise.resolve(file);

      photoCalls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);

      if (photoCalls > 2) {
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
      expect(active).toBeGreaterThanOrEqual(2);
      expect(maxActive).toBe(2);
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

  it("normalizes one image at a time on iPad-class devices", async () => {
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
      ],
      0,
      "image",
    );

    expect(active).toBe(1);
    release.shift()?.();
    await vi.waitFor(() => expect(active).toBe(1));
    release.shift()?.();
    await preparation;
    expect(maxActive).toBe(1);
    vi.unstubAllGlobals();
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
