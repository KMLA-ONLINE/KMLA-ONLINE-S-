import { describe, expect, it, vi } from "vitest";

const { getGroupPost, listGroupCategories, loadGroupDetail } = vi.hoisted(
  () => ({
    getGroupPost: vi.fn(),
    listGroupCategories: vi.fn(),
    loadGroupDetail: vi.fn(),
  }),
);

vi.mock("~/features/posts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getGroupPost,
  listGroupCategories,
}));
vi.mock("~/features/groups", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadGroupDetail,
}));

import * as postEdit from "~/routes/app/groups/post-edit";
import * as postNew from "~/routes/app/groups/post-new";

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
