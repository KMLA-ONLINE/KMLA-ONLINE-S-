import { describe, expect, it } from "vitest";

import {
  applyFeedMediaUrls,
  feedMediaPaths,
  missingImagePaths,
} from "~/features/feed/model/media";
import type { FeedPost } from "~/features/feed/model/types";

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    post_id: "post-a",
    kind: "profile",
    author_avatar_path: "avatar",
    author_avatar_url: null,
    activity_media_path: null,
    activity_media_url: null,
    attachments: [
      {
        attachment_id: "attachment-a",
        post_id: "post-a",
        storage_bucket: "post-attachments",
        object_path: "image",
        thumbnail_path: "thumb",
        original_filename: "a.webp",
        position: 0,
        mime_type: "image/webp",
        size_bytes: 1,
        width: null,
        height: null,
        signedUrl: null,
        thumbnailUrl: null,
      },
    ],
    ...overrides,
  } as FeedPost;
}

describe("feed media merge", () => {
  it("collects unique paths per bucket", () => {
    expect(feedMediaPaths([post(), post({ post_id: "post-b" })])).toEqual({
      attachments: ["image", "thumb"],
      profiles: ["avatar"],
    });
  });

  it("fills URLs by path and keeps the post when nothing matches", () => {
    const original = post();
    expect(
      applyFeedMediaUrls(original, { attachments: {}, profiles: {} }),
    ).toBe(original);

    const signed = applyFeedMediaUrls(original, {
      attachments: { image: "signed-image" },
      profiles: { avatar: "signed-avatar" },
    });
    expect(signed.author_avatar_url).toBe("signed-avatar");
    expect(signed.attachments[0]).toMatchObject({
      signedUrl: "signed-image",
      thumbnailUrl: null,
    });
    expect(missingImagePaths(signed)).toEqual([]);
    expect(missingImagePaths(original)).toEqual(["image"]);
  });
});
