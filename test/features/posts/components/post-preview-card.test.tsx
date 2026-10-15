import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPostPreviews } = vi.hoisted(() => ({
  listPostPreviews: vi.fn(),
}));

vi.mock("~/features/posts/data/queries", () => ({ listPostPreviews }));

import { PostPreviewCard } from "~/features/posts/components/post-preview-card";
import { renderRoute, screen } from "../../../router";

const POST_ID = "6f1c2a4e-8b3d-4c5e-9a7f-0123456789ab";
const PATH = `/groups/band/posts/${POST_ID}`;

function renderCard() {
  return renderRoute(() => <PostPreviewCard postId={POST_ID} path={PATH} />);
}

beforeEach(() => {
  listPostPreviews.mockReset();
});

describe("PostPreviewCard", () => {
  it("links a readable post to its detail", async () => {
    listPostPreviews.mockResolvedValue(
      new Map([
        [
          POST_ID,
          {
            postId: POST_ID,
            kind: "group",
            groupName: "밴드부",
            title: "공연 안내",
            body: "토요일 **7시**",
            authorLabel: "익명",
            authorAvatarUrl: null,
            imageUrl: null,
          },
        ],
      ]),
    );
    renderCard();

    const link = await screen.findByRole("link", { name: /공연 안내/ });
    expect(link).toHaveAttribute("href", PATH);
    expect(link).toHaveTextContent("토요일 7시");
  });

  it("says the post is unavailable when the viewer cannot read it", async () => {
    listPostPreviews.mockResolvedValue(new Map([[POST_ID, null]]));
    renderCard();

    expect(
      await screen.findByText("볼 수 없는 게시물입니다"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("tells a load failure apart from no access and retries on request", async () => {
    listPostPreviews.mockRejectedValueOnce(new Error("network"));
    const { user } = renderCard();

    expect(
      await screen.findByText("게시물을 불러오지 못했습니다"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("볼 수 없는 게시물입니다"),
    ).not.toBeInTheDocument();

    listPostPreviews.mockResolvedValueOnce(new Map([[POST_ID, null]]));
    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(
      await screen.findByText("볼 수 없는 게시물입니다"),
    ).toBeInTheDocument();
  });
});
