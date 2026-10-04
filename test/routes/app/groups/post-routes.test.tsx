import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  deleteGroupPost,
  getGroupPost,
  listGroupCategories,
  listPostComments,
  loadGroupDetail,
} = vi.hoisted(() => ({
  deleteGroupPost: vi.fn(),
  getGroupPost: vi.fn(),
  listGroupCategories: vi.fn(),
  listPostComments: vi.fn(),
  loadGroupDetail: vi.fn(),
}));

vi.mock("~/features/posts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deleteGroupPost,
  getGroupPost,
  listGroupCategories,
  listPostComments,
}));
vi.mock("~/features/groups", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadGroupDetail,
}));

import * as post from "~/routes/app/groups/post";
import * as postEdit from "~/routes/app/groups/post-edit";
import * as postNew from "~/routes/app/groups/post-new";
import { feedKeys } from "~/features/feed";
import { groupKeys } from "~/features/groups";
import {
  getQueryClient,
  resetQueryClientForTests,
} from "~/shared/lib/query-client";

/**
 * 두 화면은 부모 그룹 route가 이미 읽어 둔 그룹과 카테고리를 그대로 쓴다. 자기 loader에서 다시
 * 읽으면 글쓰기를 누를 때마다 같은 조회가 두 번 나가고, 카테고리는 그룹을 기다렸다 나가므로
 * 왕복이 줄줄이 붙는다. 되돌아가기 쉬운 종류라 여기서 고정한다.
 */
describe("group post routes reuse the parent loader data", () => {
  it("gives the new-post route no loader of its own", () => {
    expect("clientLoader" in postNew).toBe(false);
    expect(loadGroupDetail).not.toHaveBeenCalled();
  });

  it("reads only the post in the edit route, never the categories", async () => {
    getGroupPost.mockResolvedValue({
      post_id: "post-id",
      group_id: "group-id",
      can_edit: true,
    });

    await expect(
      postEdit.clientLoader({ params: { postId: "post-id" } } as never),
    ).resolves.toEqual({
      post: { post_id: "post-id", group_id: "group-id", can_edit: true },
    });
    expect(listGroupCategories).not.toHaveBeenCalled();
  });

  it("refuses to open the editor for a post the caller cannot edit", async () => {
    getGroupPost.mockResolvedValue({ post_id: "post-id", can_edit: false });

    await expect(
      postEdit.clientLoader({ params: { postId: "post-id" } } as never),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("404s a missing post", async () => {
    getGroupPost.mockResolvedValue(null);

    await expect(
      postEdit.clientLoader({ params: { postId: "gone" } } as never),
    ).rejects.toMatchObject({ status: 404 });
  });
});

/**
 * 삭제 뒤 무효화는 그룹 id를 캐시에서 읽는다. 보통은 부모 route loader가 채워 두지만,
 * 비어 있다고 조용히 건너뛰면 방금 지운 글이 목록과 피드에 남는다.
 */
describe("deleting a group post keeps the caches honest", () => {
  function remove() {
    return post.clientAction({
      params: { slug: "group-slug", postId: "post-id" },
      request: new Request("https://example.com/", {
        method: "POST",
        body: new URLSearchParams({ intent: "delete" }),
      }),
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetQueryClientForTests();
    deleteGroupPost.mockResolvedValue(undefined);
    loadGroupDetail.mockResolvedValue({ group_id: "group-id" });
  });

  it("drops the post from the feed without reading the group again", async () => {
    const queryClient = getQueryClient();
    queryClient.setQueryData(groupKeys.detail("group-slug"), {
      group_id: "group-id",
    });
    queryClient.setQueryData(feedKeys.list(), {
      pages: [{ posts: [{ post_id: "post-id" }, { post_id: "other" }] }],
      pageParams: [null],
    });

    await expect(remove()).rejects.toMatchObject({ status: 302 });

    expect(loadGroupDetail).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(feedKeys.list())).toMatchObject({
      pages: [{ posts: [{ post_id: "other" }] }],
    });
  });

  it("loads the group when the cache is cold instead of skipping invalidation", async () => {
    const queryClient = getQueryClient();
    queryClient.setQueryData(feedKeys.list(), {
      pages: [{ posts: [{ post_id: "post-id" }] }],
      pageParams: [null],
    });

    await expect(remove()).rejects.toMatchObject({ status: 302 });

    expect(loadGroupDetail).toHaveBeenCalledWith("group-slug");
    expect(queryClient.getQueryData(feedKeys.list())).toMatchObject({
      pages: [{ posts: [] }],
    });
  });
});
