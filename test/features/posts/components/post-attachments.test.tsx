import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  PostFileList,
  PostImageGrid,
  splitPostAttachments,
} from "~/features/posts/components/post-attachments";
import type { PostAttachment } from "~/features/posts/model/types";
import { renderRoute } from "../../../router";

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

const image = (id: string) =>
  attachment({
    attachment_id: id,
    mime_type: "image/webp",
    original_filename: `${id}.webp`,
  });

describe("splitPostAttachments", () => {
  it("treats normalized WebP as images and everything else as files", () => {
    const { images, files } = splitPostAttachments([
      image("photo"),
      attachment({ attachment_id: "doc" }),
    ]);

    expect(images.map((item) => item.attachment_id)).toEqual(["photo"]);
    expect(files.map((item) => item.attachment_id)).toEqual(["doc"]);
  });
});

describe("PostImageGrid", () => {
  it("rules a single image top and bottom only", () => {
    const { unmount } = renderRoute(() => (
      <PostImageGrid images={[image("single")]} />
    ));

    // 좌우는 카드 폭에 꽉 차서 카드 테두리와 겹쳐 두 줄로 보인다.
    expect(screen.getByTestId("post-image-grid")).toHaveClass("border-y");

    unmount();
    renderRoute(() => <PostImageGrid images={[image("a"), image("b")]} />);

    expect(screen.getByTestId("post-image-grid")).not.toHaveClass("border-y");
  });

  it("renders every image up to the tile limit", () => {
    renderRoute(() => (
      <PostImageGrid images={[image("a"), image("b"), image("c")]} />
    ));

    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("caps visible tiles at five and marks the rest as overflow", () => {
    renderRoute(() => (
      <PostImageGrid images={["a", "b", "c", "d", "e", "f", "g"].map(image)} />
    ));

    expect(screen.getAllByRole("img")).toHaveLength(5);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("disables the tile when the attachment could not be signed", () => {
    renderRoute(() => (
      <PostImageGrid
        images={[
          {
            ...image("broken"),
            signedUrl: null,
          },
        ]}
      />
    ));

    expect(screen.getByRole("button", { name: /broken.webp/ })).toBeDisabled();
    expect(
      screen.getByText("이미지를 불러오지 못했습니다"),
    ).toBeInTheDocument();
  });
});

describe("PostFileList", () => {
  it("offers a download link for signed files", () => {
    renderRoute(() => <PostFileList files={[attachment({})]} />);

    expect(screen.getByRole("link", { name: /document.pdf/ })).toHaveAttribute(
      "download",
      "document.pdf",
    );
  });

  it("fails gracefully when signing fails", () => {
    renderRoute(() => (
      <PostFileList files={[attachment({ signedUrl: null })]} />
    ));

    expect(screen.getByText("다운로드할 수 없음")).toBeInTheDocument();
  });
});
