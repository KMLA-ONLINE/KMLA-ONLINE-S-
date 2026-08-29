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
  createGroupMediaUrls,
  resetGroupMediaUrlCacheForTests,
} from "~/features/groups/data/files";

describe("group media signed URLs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGroupMediaUrlCacheForTests();
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
    });
  });

  it("reuses the same URL for repeated reads of an unchanged object path", async () => {
    createSignedUrls.mockResolvedValue({
      data: [{ path: "group/icon/object", signedUrl: "signed-url-1" }],
      error: null,
    });

    const first = await createGroupMediaUrls(["group/icon/object"]);
    const second = await createGroupMediaUrls(["group/icon/object"]);

    expect(first.get("group/icon/object")).toBe("signed-url-1");
    expect(second.get("group/icon/object")).toBe("signed-url-1");
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
  });

  it("does not share bearer URLs between signed-in users", async () => {
    createSignedUrls
      .mockResolvedValueOnce({
        data: [{ path: "group/icon/object", signedUrl: "user-1-url" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ path: "group/icon/object", signedUrl: "user-2-url" }],
        error: null,
      });

    await createGroupMediaUrls(["group/icon/object"]);
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-2" } } },
    });
    const secondUser = await createGroupMediaUrls(["group/icon/object"]);

    expect(secondUser.get("group/icon/object")).toBe("user-2-url");
    expect(createSignedUrls).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent signing for the same object", async () => {
    createSignedUrls.mockResolvedValue({
      data: [{ path: "group/icon/object", signedUrl: "signed-url" }],
      error: null,
    });

    await Promise.all([
      createGroupMediaUrls(["group/icon/object"]),
      createGroupMediaUrls(["group/icon/object"]),
    ]);

    expect(createSignedUrls).toHaveBeenCalledOnce();
  });
});
