import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyAttachmentUrls,
  attachmentPaths,
  readAttachmentsJson,
} from "~/features/posts/model/attachment-json";

const attachment = {
  attachment_id: "attachment-1",
  storage_bucket: "post-attachments",
  object_path: "post-1/attachment-1",
  thumbnail_path: "post-1/attachment-1-thumb",
  original_filename: "photo.webp",
  position: 0,
  mime_type: "image/webp",
  size_bytes: 100,
  width: 100,
  height: 100,
};

describe("readAttachmentsJson", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads the list RPC attachment shape", () => {
    expect(readAttachmentsJson([attachment], "post-1")).toEqual([
      expect.objectContaining({
        attachment_id: "attachment-1",
        post_id: "post-1",
        signedUrl: null,
        thumbnailUrl: null,
      }),
    ]);
  });

  it("drops a malformed attachment but says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(
      readAttachmentsJson([{ ...attachment, position: null }], "post-1"),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("warns when the column itself is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(readAttachmentsJson(undefined, "post-1")).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("attachment URLs", () => {
  it("signs originals and thumbnails together and nulls what failed", () => {
    const [parsed] = readAttachmentsJson([attachment], "post-1");

    expect(attachmentPaths([parsed])).toEqual([
      "post-1/attachment-1",
      "post-1/attachment-1-thumb",
    ]);
    expect(
      applyAttachmentUrls(
        [parsed],
        new Map([["post-1/attachment-1", "https://signed/original"]]),
      )[0],
    ).toMatchObject({
      signedUrl: "https://signed/original",
      thumbnailUrl: null,
    });
  });
});

describe("archived GIF", () => {
  const gif = {
    ...attachment,
    attachment_id: "gif-1",
    object_path: "post-1/gif-1",
    thumbnail_path: "post-1/gif-1/thumb",
    gif_path: "post-1/gif-1/gif",
    original_filename: "gif.mp4",
    mime_type: "video/mp4",
    media_kind: "gif",
  };

  it("signs the archived GIF with the MP4 for its download", () => {
    const [parsed] = readAttachmentsJson([gif], "post-1");

    expect(attachmentPaths([parsed])).toEqual([
      "post-1/gif-1",
      "post-1/gif-1/thumb",
      "post-1/gif-1/gif",
    ]);
    expect(
      applyAttachmentUrls(
        [parsed],
        new Map([
          ["post-1/gif-1", "https://signed/mp4"],
          ["post-1/gif-1/gif", "https://signed/gif"],
        ]),
      )[0],
    ).toMatchObject({
      signedUrl: "https://signed/mp4",
      gifUrl: "https://signed/gif",
      thumbnailUrl: null,
    });
  });

  it("does not sign an expired archived GIF", () => {
    const [parsed] = readAttachmentsJson([{ ...gif, expired: true }], "post-1");

    expect(attachmentPaths([parsed])).toEqual([
      null,
      "post-1/gif-1/thumb",
      null,
    ]);
  });
});
