import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  PostFileList,
  PostImageGrid,
} from "~/features/posts/components/post-attachments";
import {
  applyAttachmentUrls,
  attachmentPaths,
  readAttachmentsJson,
} from "~/features/posts/model/attachment-json";
import type { PostAttachment } from "~/features/posts/model/types";
import { renderRoute } from "../../../router";

function attachment(overrides: Partial<PostAttachment>): PostAttachment {
  return {
    attachment_id: "a",
    post_id: "post",
    storage_bucket: "post-attachments",
    object_path: "post/a",
    original_filename: "자료.zip",
    position: 0,
    mime_type: "application/zip",
    size_bytes: 600_000,
    width: null,
    height: null,
    media_kind: null,
    signedUrl: null,
    thumbnail_path: null,
    thumbnailUrl: null,
    expired: true,
    ...overrides,
  };
}

describe("expired post attachments", () => {
  it("reads the expired flag from list rows", () => {
    const [item] = readAttachmentsJson(
      [
        {
          attachment_id: "a",
          storage_bucket: "post-attachments",
          object_path: "post/a",
          original_filename: "자료.zip",
          position: 0,
          mime_type: "application/zip",
          size_bytes: 600_000,
          expired: true,
        },
      ],
      "post",
    );
    expect(item.expired).toBe(true);
  });

  it("signs only the first frame and never uses a URL for the file", () => {
    const video = attachment({
      mime_type: "video/mp4",
      media_kind: "video",
      thumbnail_path: "post/a/thumb",
    });
    expect(attachmentPaths([video])).toEqual([null, "post/a/thumb"]);
    expect(
      applyAttachmentUrls(
        [video],
        new Map([
          ["post/a", "stale"],
          ["post/a/thumb", "poster"],
        ]),
      )[0],
    ).toMatchObject({ signedUrl: null, thumbnailUrl: "poster" });
  });

  it("shows a file's name with the expired label and no download link", () => {
    renderRoute(() => <PostFileList files={[attachment({})]} />);
    expect(screen.getByText("자료.zip")).toBeInTheDocument();
    expect(screen.getByText("보관 기간 만료")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a video's first frame with the label and does not open the viewer", () => {
    renderRoute(() => (
      <PostImageGrid
        images={[
          attachment({
            mime_type: "video/mp4",
            media_kind: "video",
            thumbnail_path: "post/a/thumb",
            thumbnailUrl: "https://example.test/poster",
          }),
        ]}
      />
    ));
    const tile = screen.getByRole("button", {
      name: "자료.zip 보관 기간 만료",
    });
    expect(tile).toBeDisabled();
    expect(within(tile).getByRole("presentation")).toHaveAttribute(
      "src",
      "https://example.test/poster",
    );
  });

  it("announces the expired label on the tile that covers the overflow", () => {
    renderRoute(() => (
      <PostImageGrid
        images={Array.from({ length: 6 }, (_, index) =>
          attachment({
            attachment_id: `a${index}`,
            mime_type: "video/mp4",
            media_kind: "video",
          }),
        )}
      />
    ));
    expect(
      screen.getAllByRole("button", {
        name: "자료.zip 보관 기간 만료, 1개 더 있음",
      }),
    ).toHaveLength(1);
  });
});
