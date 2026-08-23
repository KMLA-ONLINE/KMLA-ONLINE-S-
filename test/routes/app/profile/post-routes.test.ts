import { describe, expect, it, vi } from "vitest";

const { getProfilePost, listPostComments, loadAcceptedProfile } = vi.hoisted(
  () => ({
    getProfilePost: vi.fn(),
    listPostComments: vi.fn(),
    loadAcceptedProfile: vi.fn(),
  }),
);

vi.mock("~/features/posts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getProfilePost,
  listPostComments,
}));
vi.mock("~/features/profiles", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAcceptedProfile,
}));

import * as postEdit from "~/routes/app/profile/post-edit";
import * as postNew from "~/routes/app/profile/post-new";
import * as post from "~/routes/app/profile/post";

function detailLoader(pubId: string, postId: string) {
  return post.clientLoader({
    params: { pubId, postId },
    request: new Request(
      `https://kmla.online/profile/${pubId}/posts/${postId}`,
    ),
  } as never);
}

describe("profile post routes", () => {
  /**
   * 이 화면은 부모 프로필 route가 이미 읽어 둔 타임라인 당사자를 그대로 쓴다. 자기 loader에서
   * 다시 읽으면 글쓰기를 누를 때마다 같은 조회와 아바타 서명이 한 번씩 더 나간다.
   */
  it("gives the new-post route no loader of its own", () => {
    expect("clientLoader" in postNew).toBe(false);
    expect(loadAcceptedProfile).not.toHaveBeenCalled();
  });

  it("loads the post and its first comment page together", async () => {
    getProfilePost.mockResolvedValue({
      post_id: "post-id",
      timeline_pub_id: "jieun-29",
    });
    listPostComments.mockResolvedValue({ comments: [], nextCursor: null });

    await expect(detailLoader("jieun-29", "post-id")).resolves.toMatchObject({
      post: { post_id: "post-id" },
      comments: { comments: [] },
    });
  });

  // 게시물은 타임라인 당사자 아래에 하나의 정식 경로만 갖는다. 다른 사람 경로로 들어오면
  // 주소를 바로잡는다 — 두 주소로 같은 글이 열리면 공유 링크가 갈라진다.
  it("redirects a post opened under the wrong timeline", async () => {
    getProfilePost.mockResolvedValue({
      post_id: "post-id",
      timeline_pub_id: "jieun-29",
    });
    listPostComments.mockResolvedValue({ comments: [], nextCursor: null });

    await expect(detailLoader("seomin-30", "post-id")).rejects.toMatchObject({
      status: 302,
    });
  });

  it("404s a post the caller cannot read", async () => {
    getProfilePost.mockResolvedValue(null);
    listPostComments.mockResolvedValue({ comments: [], nextCursor: null });

    await expect(detailLoader("jieun-29", "gone")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("refuses to open the editor for a post the caller cannot edit", async () => {
    getProfilePost.mockResolvedValue({ post_id: "post-id", can_edit: false });

    await expect(
      postEdit.clientLoader({ params: { postId: "post-id" } } as never),
    ).rejects.toMatchObject({ status: 403 });
  });
});
