import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GroupPostCard } from "~/features/posts/components/group-post-card";
import { groupPost } from "../group-post-fixture";
import { renderRoute } from "../../../router";

/**
 * jsdom은 레이아웃을 계산하지 않아 모든 높이가 0이다. "더 보기"는 본문이 실제로
 * 잘렸는지를 측정해서 결정하므로, 그 측정값만 가짜로 넣어준다.
 */
function stubOverflow(overflowing: boolean) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
    overflowing ? 400 : 60,
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(66);
}

function renderCard(post = groupPost()) {
  return renderRoute(() => (
    <GroupPostCard
      post={post}
      slug="group"
      onPin={vi.fn()}
      onDelete={vi.fn()}
    />
  ));
}

afterEach(() => vi.restoreAllMocks());

describe("GroupPostCard", () => {
  it("links the title to the post", () => {
    stubOverflow(false);
    renderCard();

    expect(screen.getByRole("link", { name: "제목" })).toHaveAttribute(
      "href",
      "/groups/group/posts/post-id",
    );
    expect(screen.getByRole("link", { name: /댓글/ })).toHaveAttribute(
      "href",
      "/groups/group/posts/post-id?view=comments",
    );
  });

  /**
   * 운영진 명의는 이름을 가리지 않는다 — 배지가 이미 「운영진」이라고 밝히고 프로필도
   * 그대로 걸린다. 그런 자리에 「나」까지 붙으면 알려주는 것 없이 잡음만 된다. 이름이
   * 가려지는 익명에서만 내 글임을 알려 줄 값어치가 있다.
   */
  it("marks my own post as 나 only when the author is hidden", () => {
    stubOverflow(false);
    renderCard(groupPost({ author_identity: "staff", is_author: true }));
    expect(screen.queryByText("나")).not.toBeInTheDocument();
  });

  it("keeps the 나 badge on my anonymous post", () => {
    stubOverflow(false);
    renderCard(groupPost({ author_identity: "anonymous", is_author: true }));

    expect(screen.getByText("나")).toBeInTheDocument();
  });

  it("links identified and staff authors to their profile", () => {
    stubOverflow(false);
    renderCard(
      groupPost({
        author_identity: "staff",
        author_name: "김서민",
        author_pub_id: "author-pub-id",
      }),
    );

    expect(screen.getAllByRole("link", { name: /김서민/ })[0]).toHaveAttribute(
      "href",
      "/profile/author-pub-id",
    );
    expect(screen.getByText("운영진")).toHaveClass(
      "bg-sky-500/10",
      "text-sky-700",
    );
  });

  it("does not link anonymous authors to a profile", () => {
    stubOverflow(false);
    renderCard(
      groupPost({
        author_identity: "anonymous",
        author_name: null as unknown as string,
        author_pub_id: null as unknown as string,
      }),
    );

    // 아바타(`익명 프로필`)와 이름(`익명`) 둘 다 링크가 될 수 있는 자리다. 한쪽만 확인하면
    // 다른 쪽으로 프로필이 새는 회귀를 놓친다.
    expect(
      screen.queryByRole("link", { name: /익명/ }),
    ).not.toBeInTheDocument();
  });

  it("omits the expander when the body fits", () => {
    stubOverflow(false);
    renderCard();

    expect(
      screen.queryByRole("button", { name: "더 보기" }),
    ).not.toBeInTheDocument();
  });

  it("expands and collapses a clamped body", async () => {
    stubOverflow(true);
    const { user } = renderCard();

    await user.click(screen.getByRole("button", { name: "더 보기" }));
    const collapse = screen.getByRole("button", { name: "접기" });
    expect(collapse).toBeInTheDocument();

    await user.click(collapse);
    expect(screen.getByRole("button", { name: "더 보기" })).toBeInTheDocument();
  });

  it("does not expand when a desktop user clicks the body", async () => {
    stubOverflow(true);
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
    } as MediaQueryList);
    const { user } = renderCard(groupPost({ body: "본문 내용" }));

    await user.click(screen.getByText("본문 내용"));

    expect(screen.getByRole("button", { name: "더 보기" })).toBeInTheDocument();
  });

  it("shows the pinned banner and the category badge when they apply", () => {
    stubOverflow(false);
    renderCard(groupPost({ is_pinned: true, category_name: "공지" }));

    expect(screen.getByText("고정된 게시물")).toBeInTheDocument();
    expect(screen.getByText("공지")).toBeInTheDocument();
  });

  it("shows the overflow menu for another member's reportable post", () => {
    stubOverflow(false);
    renderCard();

    expect(
      screen.getByRole("button", { name: "게시물 옵션" }),
    ).toBeInTheDocument();
  });

  it("hides the overflow menu for own post when no other action is available", () => {
    stubOverflow(false);
    renderCard(
      groupPost({
        is_author: true,
      }),
    );

    expect(
      screen.queryByRole("button", { name: "게시물 옵션" }),
    ).not.toBeInTheDocument();
  });
});
