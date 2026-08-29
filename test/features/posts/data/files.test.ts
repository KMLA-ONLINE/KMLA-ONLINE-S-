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
  createPostAttachmentUrls,
  uploadPostAttachment,
} from "~/features/posts/data/files";
import { resetSignedUrlCacheForTests } from "~/shared/supabase/signed-urls";

// 서명 자체의 계약(캐시·배치·사용자 격리)은 test/shared/supabase/signed-urls.test.ts가
// 검증한다. 여기서는 이 모듈이 자기 버킷을 쓰는지만 본다.
describe("post attachment files", () => {
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

  it("signs against the post-attachments bucket", async () => {
    const urls = await createPostAttachmentUrls(["post/file"]);

    expect(from).toHaveBeenCalledWith("post-attachments");
    expect(urls.get("post/file")).toBe("signed:post/file");
  });

  it("uploads to the post-attachments bucket with the file's own type", async () => {
    const file = new File(["x"], "note.pdf", { type: "application/pdf" });

    await uploadPostAttachment("post/file", file);

    expect(from).toHaveBeenCalledWith("post-attachments");
    expect(upload).toHaveBeenCalledWith("post/file", file, {
      contentType: "application/pdf",
      cacheControl: "31536000",
      upsert: false,
    });
  });
});
