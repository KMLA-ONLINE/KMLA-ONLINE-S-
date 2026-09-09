import { describe, expect, it } from "vitest";

import {
  imageDownloadName,
  prepareCommentImage,
  splitPostAttachments,
  toAttachmentDownloadUrl,
} from "~/features/posts/model/attachments";
import type { PostAttachment } from "~/features/posts/model/types";

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
