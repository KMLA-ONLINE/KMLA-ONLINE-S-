import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSignedUrls: createSignedUrlsRpc, getSession } = vi.hoisted(
  () => ({
    createSignedUrls: vi.fn(),
    getSession: vi.fn(),
  }),
);

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({
    auth: { getSession },
    storage: { from: () => ({ createSignedUrls: createSignedUrlsRpc }) },
  }),
}));

import {
  createSignedUrls,
  resetSignedUrlCacheForTests,
} from "~/shared/supabase/signed-urls";

/** 요청한 경로마다 `signed:<path>`를 돌려주는 기본 동작. */
function signEverything() {
  createSignedUrlsRpc.mockImplementation((paths: string[]) =>
    Promise.resolve({
      data: paths.map((path) => ({ path, signedUrl: `signed:${path}` })),
      error: null,
    }),
  );
}

describe("storage signed URLs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSignedUrlCacheForTests();
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
    });
  });

  it("deduplicates repeated paths inside one call", async () => {
    signEverything();

    const urls = await createSignedUrls("post-attachments", [
      "post/file",
      "post/file",
      null,
      undefined,
    ]);

    expect(urls.get("post/file")).toBe("signed:post/file");
    expect(createSignedUrlsRpc).toHaveBeenCalledOnce();
    expect(createSignedUrlsRpc).toHaveBeenCalledWith(["post/file"], 3600);
  });

  it("reuses a signed URL across later calls", async () => {
    signEverything();

    const first = await createSignedUrls("group-media", ["group/icon"]);
    const second = await createSignedUrls("group-media", ["group/icon"]);

    expect(first.get("group/icon")).toBe("signed:group/icon");
    expect(second.get("group/icon")).toBe("signed:group/icon");
    expect(createSignedUrlsRpc).toHaveBeenCalledOnce();
  });

  it("signs every path in one call as a single request", async () => {
    signEverything();

    const urls = await createSignedUrls("profile-media", [
      "a/avatar",
      "b/avatar",
      "c/avatar",
    ]);

    expect(urls.size).toBe(3);
    expect(createSignedUrlsRpc).toHaveBeenCalledOnce();
    expect(createSignedUrlsRpc).toHaveBeenCalledWith(
      ["a/avatar", "b/avatar", "c/avatar"],
      3600,
    );
  });

  it("batches paths that separate concurrent callers ask for", async () => {
    signEverything();

    const [first, second] = await Promise.all([
      createSignedUrls("profile-media", ["a/avatar"]),
      createSignedUrls("profile-media", ["b/avatar"]),
    ]);

    expect(first.get("a/avatar")).toBe("signed:a/avatar");
    expect(second.get("b/avatar")).toBe("signed:b/avatar");
    // 이전 구현은 호출 단위로만 배치해서 여기서 요청이 두 번 나갔다.
    expect(createSignedUrlsRpc).toHaveBeenCalledOnce();
    expect(createSignedUrlsRpc).toHaveBeenCalledWith(
      ["a/avatar", "b/avatar"],
      3600,
    );
  });

  it("keeps separate buckets in separate requests", async () => {
    signEverything();

    await Promise.all([
      createSignedUrls("profile-media", ["a/avatar"]),
      createSignedUrls("post-attachments", ["post/file"]),
    ]);

    expect(createSignedUrlsRpc).toHaveBeenCalledTimes(2);
  });

  it("does not share signed URLs between users", async () => {
    signEverything();

    const first = await createSignedUrls("post-attachments", ["post/file"]);
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-2" } } },
    });
    const second = await createSignedUrls("post-attachments", ["post/file"]);

    expect(first.get("post/file")).toBe("signed:post/file");
    expect(second.get("post/file")).toBe("signed:post/file");
    expect(createSignedUrlsRpc).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent signing for the same path", async () => {
    signEverything();

    const [first, second] = await Promise.all([
      createSignedUrls("group-media", ["group/icon"]),
      createSignedUrls("group-media", ["group/icon"]),
    ]);

    expect(first.get("group/icon")).toBe("signed:group/icon");
    expect(second.get("group/icon")).toBe("signed:group/icon");
    expect(createSignedUrlsRpc).toHaveBeenCalledOnce();
  });

  it("drops only the paths Storage did not sign", async () => {
    createSignedUrlsRpc.mockResolvedValue({
      data: [{ path: "ok/file", signedUrl: "signed:ok/file" }],
      error: null,
    });

    const urls = await createSignedUrls("post-attachments", [
      "ok/file",
      "denied/file",
    ]);

    expect(urls.get("ok/file")).toBe("signed:ok/file");
    expect(urls.has("denied/file")).toBe(false);
  });

  it("does not cache a failure", async () => {
    createSignedUrlsRpc.mockResolvedValueOnce({
      data: null,
      error: new Error("network down"),
    });
    signEverything();

    const failed = await createSignedUrls("group-media", ["group/icon"]);
    const retried = await createSignedUrls("group-media", ["group/icon"]);

    expect(failed.has("group/icon")).toBe(false);
    expect(retried.get("group/icon")).toBe("signed:group/icon");
  });

  it("signs without caching when there is no session", async () => {
    signEverything();
    getSession.mockResolvedValue({ data: { session: null } });

    const first = await createSignedUrls("group-media", ["group/icon"]);
    const second = await createSignedUrls("group-media", ["group/icon"]);

    expect(first.get("group/icon")).toBe("signed:group/icon");
    expect(second.get("group/icon")).toBe("signed:group/icon");
    expect(createSignedUrlsRpc).toHaveBeenCalledTimes(2);
  });

  it("makes no request when there is nothing to sign", async () => {
    signEverything();

    const urls = await createSignedUrls("post-attachments", [null, undefined]);

    expect(urls.size).toBe(0);
    expect(createSignedUrlsRpc).not.toHaveBeenCalled();
  });
});
