import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSignedUrls, getSession } = vi.hoisted(() => ({
  createSignedUrls: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({
    auth: { getSession },
    storage: { from: () => ({ createSignedUrls }) },
  }),
}));

import {
  createPostAttachmentUrls,
  resetPostAttachmentUrlCacheForTests,
} from "~/features/posts/data/files";

describe("post attachment signed URLs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPostAttachmentUrlCacheForTests();
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
    });
  });

  it("deduplicates paths and reuses signed URLs", async () => {
    createSignedUrls.mockResolvedValue({
      data: [{ path: "post/file", signedUrl: "signed-url" }],
      error: null,
    });

    const first = await createPostAttachmentUrls(["post/file", "post/file"]);
    const second = await createPostAttachmentUrls(["post/file"]);

    expect(first.get("post/file")).toBe("signed-url");
    expect(second.get("post/file")).toBe("signed-url");
    expect(createSignedUrls).toHaveBeenCalledOnce();
    expect(createSignedUrls).toHaveBeenCalledWith(["post/file"], 3600);
  });

  it("does not share signed URLs between users", async () => {
    createSignedUrls
      .mockResolvedValueOnce({
        data: [{ path: "post/file", signedUrl: "user-1-url" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ path: "post/file", signedUrl: "user-2-url" }],
        error: null,
      });

    await createPostAttachmentUrls(["post/file"]);
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-2" } } },
    });
    const secondUser = await createPostAttachmentUrls(["post/file"]);

    expect(secondUser.get("post/file")).toBe("user-2-url");
    expect(createSignedUrls).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent signing for the same path", async () => {
    createSignedUrls.mockResolvedValue({
      data: [{ path: "post/file", signedUrl: "signed-url" }],
      error: null,
    });

    const [first, second] = await Promise.all([
      createPostAttachmentUrls(["post/file"]),
      createPostAttachmentUrls(["post/file"]),
    ]);

    expect(first.get("post/file")).toBe("signed-url");
    expect(second.get("post/file")).toBe("signed-url");
    expect(createSignedUrls).toHaveBeenCalledOnce();
  });
});
