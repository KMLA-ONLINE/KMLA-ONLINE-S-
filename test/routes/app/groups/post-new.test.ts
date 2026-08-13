import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";

const { createGroupPost, loadGroupDetail } = vi.hoisted(() => ({
  createGroupPost: vi.fn(),
  loadGroupDetail: vi.fn(),
}));

vi.mock("~/features/posts", async (importOriginal) => ({
  ...(await importOriginal()),
  createGroupPost,
}));

vi.mock("~/features/groups", async (importOriginal) => ({
  ...(await importOriginal()),
  loadGroupDetail,
}));

import { clientAction } from "~/routes/app/groups/post-new";

describe("new group post route action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns field errors without calling Supabase for invalid text", async () => {
    const result = await clientAction({
      request: new Request("https://example.com/groups/test/posts/new", {
        method: "POST",
        body: new URLSearchParams({ title: "", body: "" }),
      }),
      params: { slug: "test" },
      context: new RouterContextProvider(),
      url: new URL("https://example.com/groups/test/posts/new"),
      pattern: "/groups/:slug/posts/new",
      serverAction: () => Promise.resolve(undefined),
    });

    expect(result).toMatchObject({ init: { status: 400 } });
    expect(createGroupPost).not.toHaveBeenCalled();
  });

  it("redirects to the canonical detail after creation", async () => {
    loadGroupDetail.mockResolvedValue({
      group_id: "group-id",
      membership_state: "member",
      posting_policy: "members",
      member_role: "member",
    });
    createGroupPost.mockResolvedValue("post-id");

    await expect(
      clientAction({
        request: new Request("https://example.com/groups/test/posts/new", {
          method: "POST",
          body: new URLSearchParams({
            title: "제목",
            body: "본문",
            authorIdentity: "identified",
          }),
        }),
        params: { slug: "test" },
        context: new RouterContextProvider(),
        url: new URL("https://example.com/groups/test/posts/new"),
        pattern: "/groups/:slug/posts/new",
        serverAction: () => Promise.resolve(undefined),
      }),
    ).rejects.toMatchObject({
      status: 302,
      headers: expect.objectContaining({}),
    });
    expect(createGroupPost).toHaveBeenCalledWith(
      "group-id",
      expect.objectContaining({ title: "제목", body: "본문" }),
    );
  });
});
