import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSignedUrls, from } = vi.hoisted(() => ({
  createSignedUrls: vi.fn(),
  from: vi.fn(),
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

import { createProfileMediaUrls } from "~/features/profiles/data/media";
import { resetSignedUrlCacheForTests } from "~/shared/supabase/signed-urls";

describe("profile media URLs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSignedUrlCacheForTests();
    from.mockReturnValue({ createSignedUrls });
    createSignedUrls.mockImplementation((paths: string[]) =>
      Promise.resolve({
        data: paths.map((path) => ({ path, signedUrl: `signed:${path}` })),
        error: null,
      }),
    );
  });

  it("signs against the profile-media bucket", async () => {
    const urls = await createProfileMediaUrls(["user/avatar"]);

    expect(from).toHaveBeenCalledWith("profile-media");
    expect(urls.get("user/avatar")).toBe("signed:user/avatar");
  });

  /**
   * Storage 밖에 있는 이미지는 이미 완성된 URL이라 서명 대상이 아니다. 여기에 섞여
   * 들어가면 Storage가 경로로 읽고 거절한다.
   */
  it("passes external URLs through without signing them", async () => {
    const external = "https://cdn.example.com/avatar.png";

    const urls = await createProfileMediaUrls([external, "user/avatar"]);

    expect(urls.get(external)).toBe(external);
    expect(urls.get("user/avatar")).toBe("signed:user/avatar");
    expect(createSignedUrls).toHaveBeenCalledWith(["user/avatar"], 3600);
  });

  it("makes no request when every path is external", async () => {
    const external = "https://cdn.example.com/avatar.png";

    const urls = await createProfileMediaUrls([external, null]);

    expect(urls.get(external)).toBe(external);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});
