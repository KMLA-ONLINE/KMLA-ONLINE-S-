import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, uploadPostAttachment } = vi.hoisted(() => ({
  rpc: vi.fn(),
  uploadPostAttachment: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({ rpc }),
}));
vi.mock("~/features/posts/data/files", () => ({ uploadPostAttachment }));

import {
  createGroupPostWithAttachments,
  createPostUploadSession,
} from "~/features/posts/data/mutations";

const values = {
  title: "제목",
  body: "",
  categoryId: "",
  authorIdentity: "identified" as const,
};
const prepared = {
  key: "file-key",
  file: new File(["image"], "photo.webp", { type: "image/webp" }),
  kind: "image" as const,
  width: 100,
  height: 80,
  previewUrl: "blob:preview",
};

describe("post attachment orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockImplementation((name: string) => {
      if (name === "create_group_post")
        return Promise.resolve({ data: "post-id", error: null });
      if (name === "prepare_post_attachment")
        return Promise.resolve({
          data: { id: "attachment-id", object_path: "post-id/attachment-id" },
          error: null,
        });
      return Promise.resolve({ data: null, error: null });
    });
    uploadPostAttachment.mockResolvedValue(undefined);
  });

  it("creates a draft, prepares, uploads, finalizes, then publishes", async () => {
    await expect(
      createGroupPostWithAttachments(
        "group-id",
        values,
        [prepared],
        createPostUploadSession(),
      ),
    ).resolves.toBe("post-id");

    expect(rpc.mock.calls.map((call) => call[0] as string)).toEqual([
      "create_group_post",
      "prepare_post_attachment",
      "finalize_post_attachment",
      "publish_group_post",
    ]);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "create_group_post",
      expect.objectContaining({ p_publish: false }),
    );
    expect(uploadPostAttachment).toHaveBeenCalledWith(
      "post-id/attachment-id",
      prepared.file,
    );
  });

  it("reuses draft and prepared metadata when retrying", async () => {
    const session = createPostUploadSession();
    rpc.mockImplementationOnce(() =>
      Promise.resolve({ data: "post-id", error: null }),
    );
    rpc.mockImplementationOnce(() =>
      Promise.resolve({
        data: { id: "attachment-id", object_path: "post-id/attachment-id" },
        error: null,
      }),
    );
    uploadPostAttachment.mockRejectedValueOnce(new Error("offline"));
    rpc.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: new Error("not uploaded") }),
    );

    await expect(
      createGroupPostWithAttachments("group-id", values, [prepared], session),
    ).rejects.toThrow("offline");
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    uploadPostAttachment.mockResolvedValue(undefined);
    await expect(
      createGroupPostWithAttachments("group-id", values, [prepared], session),
    ).resolves.toBe("post-id");

    expect(
      rpc.mock.calls.filter(([name]) => name === "create_group_post"),
    ).toHaveLength(1);
    expect(
      rpc.mock.calls.filter(([name]) => name === "prepare_post_attachment"),
    ).toHaveLength(1);
  });
});
