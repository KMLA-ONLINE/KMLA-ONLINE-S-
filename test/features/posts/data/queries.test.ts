import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPostAttachmentUrls, getSupabase } = vi.hoisted(() => ({
  createPostAttachmentUrls: vi.fn().mockResolvedValue(new Map()),
  getSupabase: vi.fn(),
}));

vi.mock("~/features/posts/data/files", () => ({ createPostAttachmentUrls }));
vi.mock("~/shared/supabase/client", () => ({ getSupabase }));

import {
  listGroupPosts,
  searchGroupPosts,
} from "~/features/posts/data/queries";

describe("post queries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not load or sign attachments for search results", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ post_id: "post-id", title: "결과" }],
      error: null,
    });
    const from = vi.fn();
    getSupabase.mockReturnValue({ rpc, from });

    await expect(searchGroupPosts("group-id", "검색")).resolves.toEqual([
      { post_id: "post-id", title: "결과" },
    ]);
    expect(from).not.toHaveBeenCalled();
    expect(createPostAttachmentUrls).not.toHaveBeenCalled();
  });

  it("propagates attachment metadata query failures", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          post_id: "post-id",
          published_at: "2026-08-13T00:00:00Z",
        },
      ],
      error: null,
    });
    const attachmentError = new Error("attachment metadata failed");
    const query = {
      select: vi.fn(),
      in: vi.fn(),
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({ data: null, error: attachmentError }),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    getSupabase.mockReturnValue({
      rpc,
      from: vi.fn().mockReturnValue(query),
    });

    await expect(listGroupPosts("group-id")).rejects.toBe(attachmentError);
    expect(createPostAttachmentUrls).not.toHaveBeenCalled();
  });

  it("uses pinned state as part of the next-page cursor", async () => {
    const rows = Array.from({ length: 13 }, (_, index) => ({
      post_id: `post-${index}`,
      published_at: `2026-08-13T00:00:${String(59 - index).padStart(2, "0")}Z`,
      is_pinned: index < 12,
    }));
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    const query = {
      select: vi.fn(),
      in: vi.fn(),
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    getSupabase.mockReturnValue({ rpc, from: vi.fn().mockReturnValue(query) });

    const page = await listGroupPosts("group-id");
    expect(page.nextCursor).toEqual({
      publishedAt: rows[11].published_at,
      postId: "post-11",
      isPinned: true,
    });
  });
});
