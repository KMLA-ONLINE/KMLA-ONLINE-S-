import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSignedUrls, from, upload } = vi.hoisted(() => ({
  createSignedUrls: vi.fn(),
  from: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: "user-1" } } } }),
    },
    storage: { from },
  }),
}));

import {
  createGroupMediaUrls,
  uploadGroupMedia,
} from "~/features/groups/data/files";
import { resetSignedUrlCacheForTests } from "~/shared/supabase/signed-urls";

// 서명 자체의 계약은 test/shared/supabase/signed-urls.test.ts가 검증한다.
describe("group media files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSignedUrlCacheForTests();
    from.mockReturnValue({ createSignedUrls, upload });
    createSignedUrls.mockImplementation((paths: string[]) =>
      Promise.resolve({
        data: paths.map((path) => ({ path, signedUrl: `signed:${path}` })),
        error: null,
      }),
    );
    upload.mockResolvedValue({ error: null });
  });

  it("signs against the group-media bucket and skips empty slots", async () => {
    const urls = await createGroupMediaUrls(["group/icon", null]);

    expect(from).toHaveBeenCalledWith("group-media");
    expect(urls.get("group/icon")).toBe("signed:group/icon");
    expect(urls.size).toBe(1);
  });

  it("uploads group media as webp", async () => {
    const file = new File(["x"], "icon.webp", { type: "image/webp" });

    await uploadGroupMedia("group/icon", file);

    expect(upload).toHaveBeenCalledWith("group/icon", file, {
      contentType: "image/webp",
      upsert: false,
    });
  });
});
