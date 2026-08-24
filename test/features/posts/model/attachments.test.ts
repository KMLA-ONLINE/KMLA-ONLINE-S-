import { describe, expect, it } from "vitest";

import {
  imageDownloadName,
  prepareCommentImage,
  toAttachmentDownloadUrl,
} from "~/features/posts/model/attachments";

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
