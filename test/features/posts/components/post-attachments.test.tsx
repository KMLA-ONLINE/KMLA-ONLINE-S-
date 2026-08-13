import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PostAttachments } from "~/features/posts/components/group-post-overlay";
import type { PostAttachment } from "~/features/posts/model/types";

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
    width: null,
    signedUrl: "https://example.com/file",
    ...overrides,
  };
}

describe("PostAttachments", () => {
  it("renders normalized WebP inline and other MIME types as downloads only", () => {
    render(
      <PostAttachments
        attachments={[
          attachment({
            attachment_id: "image",
            mime_type: "image/webp",
            original_filename: "photo.webp",
          }),
          attachment({ attachment_id: "file" }),
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: "photo.webp" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /document.pdf/ })).toHaveAttribute(
      "download",
      "document.pdf",
    );
  });

  it("fails gracefully when signing fails", () => {
    render(<PostAttachments attachments={[attachment({ signedUrl: null })]} />);
    expect(screen.getByText(/다운로드할 수 없음/)).toBeInTheDocument();
  });
});
