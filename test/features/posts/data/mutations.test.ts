import { beforeEach, describe, expect, it, vi } from "vitest";

const { hydratePostComments, rpc, uploadPostAttachment } = vi.hoisted(() => ({
  hydratePostComments: vi.fn((comments: object[]) =>
    Promise.resolve(
      comments.map((comment: object) => ({ ...comment, images: [] })),
    ),
  ),
  rpc: vi.fn(),
  uploadPostAttachment: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({ rpc }),
}));
vi.mock("~/features/posts/data/files", () => ({ uploadPostAttachment }));
vi.mock("~/features/posts/data/queries", () => ({ hydratePostComments }));

import {
  createGroupPostWithAttachments,
  createCommentImageUploadSession,
  createPostComment,
  createPostUploadSession,
  updatePostComment,
  restrictGroupAnonymousActivity,
  cancelGroupAnonymousActivityRestriction,
} from "~/features/posts/data/mutations";

describe("anonymous activity restriction mutations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses only the public source kind and source id", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ restriction_id: "restriction-id", expires_at: "expires" }],
      error: null,
    });
    await restrictGroupAnonymousActivity(
      "comment",
      "comment-id",
      "제한 사유입니다",
      30,
    );
    expect(rpc).toHaveBeenCalledWith("restrict_group_anonymous_activity", {
      p_source_kind: "comment",
      p_source_id: "comment-id",
      p_reason: "제한 사유입니다",
      p_duration_days: 30,
    });

    rpc.mockResolvedValueOnce({ data: null, error: null });
    await cancelGroupAnonymousActivityRestriction("comment", "comment-id");
    expect(rpc).toHaveBeenLastCalledWith(
      "cancel_group_anonymous_activity_restriction",
      { p_source_kind: "comment", p_source_id: "comment-id" },
    );
  });
});

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
      "commit_group_post",
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

  it("commits the latest form values when retrying a draft", async () => {
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
    await createGroupPostWithAttachments(
      "group-id",
      { ...values, title: "수정한 제목", body: "수정한 본문" },
      [prepared],
      session,
    );

    expect(rpc).toHaveBeenLastCalledWith(
      "commit_group_post",
      expect.objectContaining({
        p_title: "수정한 제목",
        p_body: "수정한 본문",
        p_attachment_ids: ["attachment-id"],
        p_publish: true,
      }),
    );
  });
});

describe("comment image orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadPostAttachment.mockResolvedValue(undefined);
    rpc.mockImplementation((name: string) => {
      if (name === "prepare_comment_image")
        return Promise.resolve({
          data: {
            id: "image-id",
            object_path: "comments/post-id/image-id",
            storage_bucket: "post-attachments",
          },
          error: null,
        });
      if (name === "create_post_comment")
        return Promise.resolve({
          data: [{ comment_id: "comment-id", post_id: "post-id" }],
          error: null,
        });
      return Promise.resolve({ data: null, error: null });
    });
  });

  it("uploads and finalizes before creating the comment", async () => {
    await createPostComment(
      "post-id",
      "",
      "identified",
      null,
      prepared,
      createCommentImageUploadSession(),
    );

    expect(rpc.mock.calls.map((call) => call[0] as string)).toEqual([
      "prepare_comment_image",
      "finalize_comment_image",
      "create_post_comment",
    ]);
    expect(uploadPostAttachment).toHaveBeenCalledWith(
      "comments/post-id/image-id",
      prepared.file,
    );
    expect(rpc).toHaveBeenLastCalledWith(
      "create_post_comment",
      expect.objectContaining({ p_body: "", p_image_id: "image-id" }),
    );
  });

  it("does not report a committed comment as failed when image hydration fails", async () => {
    hydratePostComments.mockRejectedValueOnce(new Error("signing failed"));

    const created = await createPostComment(
      "post-id",
      "",
      "identified",
      null,
      prepared,
      createCommentImageUploadSession(),
    );

    expect(created.images).toEqual([]);
    expect(
      rpc.mock.calls.filter(([name]) => name === "create_post_comment"),
    ).toHaveLength(1);
  });

  it("does not create a comment after upload failure and reuses preparation on retry", async () => {
    const session = createCommentImageUploadSession();
    uploadPostAttachment.mockRejectedValueOnce(new Error("offline"));
    rpc.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          id: "image-id",
          object_path: "comments/post-id/image-id",
          storage_bucket: "post-attachments",
        },
        error: null,
      }),
    );
    rpc.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: new Error("not uploaded") }),
    );

    await expect(
      createPostComment(
        "post-id",
        "image",
        "identified",
        null,
        prepared,
        session,
      ),
    ).rejects.toThrow("offline");
    expect(
      rpc.mock.calls.filter(([name]) => name === "create_post_comment"),
    ).toHaveLength(0);

    await createPostComment(
      "post-id",
      "image",
      "identified",
      null,
      prepared,
      session,
    );
    expect(
      rpc.mock.calls.filter(([name]) => name === "prepare_comment_image"),
    ).toHaveLength(1);
  });

  it("passes an explicit flag to remove an image while updating", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "update_post_comment")
        return Promise.resolve({
          data: [{ comment_id: "comment-id", post_id: "post-id" }],
          error: null,
        });
      return Promise.resolve({ data: null, error: null });
    });

    await updatePostComment("comment-id", "updated", "post-id", null);

    expect(rpc).toHaveBeenCalledWith("update_post_comment", {
      p_comment_id: "comment-id",
      p_body: "updated",
      p_image_id: undefined,
      p_remove_image: true,
    });
  });
});
