import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSignedUrls, from, rpc, upload } = vi.hoisted(() => ({
  createSignedUrls: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: "user-1" } } } }),
    },
    storage: { from },
    rpc,
  }),
}));

import {
  createProfileMediaUrls,
  replaceProfileMedia,
} from "~/features/profiles/data/media";
import { resetSignedUrlCacheForTests } from "~/shared/supabase/signed-urls";

describe("profile media URLs", () => {
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
  });

  it("signs against the profile-media bucket", async () => {
    const urls = await createProfileMediaUrls(["user/avatar"]);

    expect(from).toHaveBeenCalledWith("profile-media");
    expect(urls.get("user/avatar")).toBe("signed:user/avatar");
  });

  it("skips empty paths without making a request", async () => {
    const urls = await createProfileMediaUrls([null, undefined]);

    expect(urls.size).toBe(0);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});

describe("replacing profile media", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockReturnValue({ upload });
    upload.mockResolvedValue({ error: null });
    rpc.mockImplementation((name: string) =>
      name === "prepare_profile_media"
        ? Promise.resolve({
            data: [
              {
                media_id: "media-1",
                object_path: "user-1/avatar/media-1",
                activity_media_id: "activity-1",
                activity_object_path: "user-1/avatar/activity-1",
              },
            ],
            error: null,
          })
        : Promise.resolve({ error: null }),
    );
  });

  it("uploads avatar slot and activity files only to server-prepared paths", async () => {
    await replaceProfileMedia(
      "avatar",
      new File(["x"], "a.webp"),
      { width: 100, height: 100 },
      {
        file: new File(["activity"], "activity.webp"),
        width: 200,
        height: 200,
      },
    );

    expect(rpc).toHaveBeenNthCalledWith(1, "prepare_profile_media", {
      p_slot: "avatar",
      p_size_bytes: 1,
      p_width: 100,
      p_height: 100,
      p_activity_size_bytes: 8,
      p_activity_width: 200,
      p_activity_height: 200,
    });
    expect(upload).toHaveBeenCalledWith(
      "user-1/avatar/media-1",
      expect.any(File),
      expect.objectContaining({ upsert: false }),
    );
    expect(upload).toHaveBeenCalledWith(
      "user-1/avatar/activity-1",
      expect.any(File),
      expect.objectContaining({ upsert: false }),
    );
    expect(rpc).toHaveBeenNthCalledWith(2, "finalize_profile_media", {
      p_media_id: "media-1",
    });
  });

  /**
   * 업로드가 실패하면 finalize를 부르지 않는다. 남은 `pending` 행과 object는 정리 큐가
   * 48시간 뒤에 가져가므로 클라이언트가 되돌릴 것이 없다.
   */
  it("does not finalize when the upload fails", async () => {
    upload.mockResolvedValue({ error: new Error("network") });

    await expect(
      replaceProfileMedia("cover", new File(["x"], "a.webp"), {
        width: 300,
        height: 100,
      }),
    ).rejects.toThrow("network");

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not finalize when the high-resolution activity upload fails", async () => {
    upload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error("network") });

    await expect(
      replaceProfileMedia(
        "avatar",
        new File(["x"], "a.webp"),
        { width: 100, height: 100 },
        {
          file: new File(["activity"], "activity.webp"),
          width: 200,
          height: 200,
        },
      ),
    ).rejects.toThrow("network");

    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
