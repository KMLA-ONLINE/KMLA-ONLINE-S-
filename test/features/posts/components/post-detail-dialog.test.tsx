import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PostDetailDialog } from "~/features/posts/components/post-detail-dialog";
import { postComment } from "../post-comment-fixture";
import { renderRoute } from "../../../router";

const originalInnerHeight = window.innerHeight;
const originalVisualViewport = window.visualViewport;

function stubVisualViewport(height: number, offsetTop = 0) {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      height,
      offsetTop,
      scale: 1,
    }),
  });
}

function stubTabletSheetViewport(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: originalInnerHeight,
  });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: originalVisualViewport,
  });
});

function Detail({ withComment = false }: { withComment?: boolean }) {
  return (
    <PostDetailDialog
      title="게시물"
      postId="post-id"
      comments={{
        comments: withComment
          ? [postComment({ comment_id: "target", body: "답글 대상" })]
          : [],
        nextCursor: null,
      }}
      viewer={{ name: "홍길동", avatarUrl: null }}
      identities={["identified"]}
      onClose={vi.fn()}
      actionBar={{
        reaction: {
          reaction_count: 0,
          top_reactions: [],
          my_reaction: null,
        },
        sharePath: "/posts/post-id",
        shareTitle: "게시물",
        commentCount: 0,
      }}
    >
      <p>게시물 본문</p>
    </PostDetailDialog>
  );
}

describe("PostDetailDialog", () => {
  it("does not focus the composer when opening a comment sheet", async () => {
    stubTabletSheetViewport(true);
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });

    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    expect(
      screen.getByRole("textbox", { name: "댓글 입력" }),
    ).not.toHaveFocus();
  });

  it("uses a centered bottom sheet through the tablet breakpoint", () => {
    stubTabletSheetViewport(true);
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });

    expect(screen.getByRole("dialog")).toHaveClass(
      "max-[1025px]:bottom-0",
      "md:max-[1025px]:left-1/2",
      "md:max-[1025px]:-translate-x-1/2",
    );
  });

  /**
   * 회귀: 시트 여부를 뷰포트만으로 정하던 때에는, 글을 쓰고 상세로 이동하기만 해도 본문이
   * 숨겨진 댓글 서랍이 떴다. 댓글만 보러 왔다는 의도가 함께 있어야 시트다.
   */
  it("opens the post itself as a detail modal on a tablet viewport", () => {
    stubTabletSheetViewport(true);
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id"],
    });

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("max-md:h-svh");
    expect(dialog).not.toHaveClass("max-[1025px]:bottom-0");
    // 시트에서는 머리글이 제목 대신 「댓글」이 된다.
    expect(screen.queryByText("댓글")).not.toBeInTheDocument();
    expect(screen.getByText("게시물 본문")).toBeInTheDocument();
  });

  it("keeps a computer comment button as a focused detail modal", async () => {
    stubTabletSheetViewport(false);
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "댓글 입력" })).toHaveFocus(),
    );
  });

  it("does not focus the composer for a regular detail link", async () => {
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id"],
    });

    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    expect(
      screen.getByRole("textbox", { name: "댓글 입력" }),
    ).not.toHaveFocus();
  });

  it("keeps the mobile comment sheet inside the visual viewport", async () => {
    stubTabletSheetViewport(true);
    stubVisualViewport(500, 100);
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });

    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveStyle({
        bottom: "200px",
        maxHeight: "500px",
      }),
    );
  });

  it("scrolls only enough to reveal a reply target after resizing", async () => {
    stubTabletSheetViewport(true);
    stubVisualViewport(500);
    const { user } = renderRoute(() => <Detail withComment />, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });
    /* eslint-disable testing-library/no-node-access --
       The behavior under test is the scroll relationship between the rendered
       comment and the dialog's private overflow container. */
    const target = document.getElementById("comment-target");
    const container = target?.closest("section")?.parentElement;
    /* eslint-enable testing-library/no-node-access */
    expect(target).not.toBeNull();
    expect(container).not.toBeNull();
    if (!target || !container) return;

    container.scrollTop = 100;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
    } as DOMRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 260,
      bottom: 350,
    } as DOMRect);

    await user.click(screen.getByRole("button", { name: "답글" }));

    await waitFor(() => expect(container.scrollTop).toBe(150));
  });

  it("does not refocus the composer when cancelling a reply", async () => {
    const { user } = renderRoute(() => <Detail withComment />, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });
    const composer = screen.getByRole("textbox", { name: "댓글 입력" });

    await user.click(screen.getByRole("button", { name: "답글" }));
    await waitFor(() => expect(composer).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "답글 대상 취소" }));

    expect(composer).not.toHaveFocus();
  });
});
