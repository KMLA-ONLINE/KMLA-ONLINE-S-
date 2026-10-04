import { screen } from "@testing-library/react";
import { useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GroupPostCard } from "~/features/posts/components/group/group-post-card";
import { isFromGroup } from "~/features/posts/model/navigation";
import { groupPost } from "../../group-post-fixture";
import { renderRoute } from "../../../../router";

/** state는 DOM에 남지 않으므로 실제로 눌러서 도착지가 무엇을 받았는지 본다. */
function Landing() {
  return <p>{isFromGroup(useLocation().state) ? "표식 있음" : "표식 없음"}</p>;
}

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
    // 글자 배지가 아니라 파란 체크다. 화면에 글자가 없으므로 뜻은 접근성 이름이 진다.
    expect(screen.getByRole("img", { name: "운영진 명의" })).toBeVisible();
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

  /**
   * 상세는 이 표식으로 "◯◯ 그룹으로 이동" 링크를 감춘다(`model/navigation.ts`). 제목과 댓글
   * 링크가 둘 다 상세를 열므로 양쪽 모두 심어야 한다.
   */
  it("marks both routes into the post as opened from inside the group", async () => {
    for (const name of ["제목", "댓글 0개"]) {
      const { user, unmount } = renderRoute(
        () => (
          <GroupPostCard
            post={groupPost()}
            slug="group"
            onPin={vi.fn()}
            onDelete={vi.fn()}
          />
        ),
        {
          routes: [{ path: "/groups/group/posts/post-id", Component: Landing }],
        },
      );

      await user.click(screen.getByRole("link", { name }));
      expect(await screen.findByText("표식 있음")).toBeVisible();
      unmount();
    }
  });
});
