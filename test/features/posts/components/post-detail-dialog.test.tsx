import { act, fireEvent, screen, waitFor } from "@testing-library/react";
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

function stubPostDetailViewport({
  sheet,
  touchPrimary = sheet,
}: {
  sheet: boolean;
  touchPrimary?: boolean;
}) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: query.includes("max-width: 1024px") ? sheet : touchPrimary,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
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

function Detail({
  withComment = false,
  onClose = vi.fn(),
}: {
  withComment?: boolean;
  onClose?: () => void;
}) {
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
      onClose={onClose}
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

/** 댓글이 놓인 스크롤 영역. 모달이 안에 감춰 두고 있어 역할로는 잡히지 않는다. */
function commentList() {
  /* eslint-disable testing-library/no-node-access --
     The dialog's overflow container is private; the drag behavior lives on it. */
  const list = document
    .getElementById("comment-target")
    ?.closest("section")?.parentElement;
  /* eslint-enable testing-library/no-node-access */
  if (!list) throw new Error("comment list container is missing");
  return list;
}

/**
 * 손가락으로 아래로 당기기.
 *
 * 포인터가 아니라 터치인 것이 요점이다. 스크롤 영역 위의 세로 손짓은 브라우저가 가져가서
 * 포인터 이벤트를 끊어 버리므로, 목록에서 시트를 닫는 손짓은 터치로만 잡힌다.
 */
function pullDown(element: HTMLElement, distance: number) {
  fireEvent.touchStart(element, {
    touches: [{ identifier: 1, clientX: 20, clientY: 20 }],
  });
  fireEvent.touchMove(element, {
    touches: [{ identifier: 1, clientX: 20, clientY: 20 + distance }],
  });
  fireEvent.touchEnd(element);
}

describe("PostDetailDialog", () => {
  it("does not focus the composer when opening a comment sheet", async () => {
    stubPostDetailViewport({ sheet: true });
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });

    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    expect(
      screen.getByRole("textbox", { name: "댓글 입력" }),
    ).not.toHaveFocus();
  });

  /**
   * 회귀: 시트 여부를 뷰포트만으로 정하던 때에는, 글을 쓰고 상세로 이동하기만 해도 본문이
   * 숨겨진 댓글 서랍이 떴다. 댓글만 보러 왔다는 의도가 함께 있어야 시트다.
   */
  it("opens the post itself as a detail modal on a tablet viewport", () => {
    stubPostDetailViewport({ sheet: true });
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
    stubPostDetailViewport({ sheet: false });
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "댓글 입력" })).toHaveFocus(),
    );
  });

  it("does not focus the composer in a wide touch-primary tablet modal", async () => {
    stubPostDetailViewport({ sheet: false, touchPrimary: true });
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });

    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    expect(
      screen.getByRole("textbox", { name: "댓글 입력" }),
    ).not.toHaveFocus();
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
    stubPostDetailViewport({ sheet: true });
    stubVisualViewport(500, 100);
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });

    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveStyle({
        bottom: "auto",
        top: "100px",
        height: "500px",
        maxHeight: "500px",
      }),
    );
  });

  it("keeps a mobile post detail composer inside the visual viewport", async () => {
    stubPostDetailViewport({ sheet: true });
    stubVisualViewport(500, 100);
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id"],
    });

    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveStyle({
        bottom: "auto",
        top: "100px",
        height: "500px",
        maxHeight: "500px",
      }),
    );
  });

  /**
   * 회귀: 안드로이드 Chrome은 키보드를 띄우며 화면을 키보드 높이만큼 끌어올린다. 그러면 가려진
   * 아래쪽이 0이라 키보드가 없는 것으로 읽혀, 위에 붙은 상세 모달의 윗부분이 화면 밖으로 밀리고
   * 답글 대상이 보이는 것으로 계산되어 스크롤도 하지 않았다.
   */
  it("keeps a mobile post detail inside a visual viewport the keyboard pushed up", async () => {
    stubPostDetailViewport({ sheet: true });
    stubVisualViewport(500, 300);
    renderRoute(Detail, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id"],
    });

    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveStyle({
        bottom: "auto",
        top: "300px",
        height: "500px",
        maxHeight: "500px",
      }),
    );
  });

  it.each(["", "?view=comments"])(
    "tracks keyboard panning and restores the dialog after dismissal (%s)",
    async (query) => {
      stubPostDetailViewport({ sheet: true });
      stubVisualViewport(800);
      const { user } = renderRoute(() => <Detail withComment />, {
        path: "/posts/:postId",
        initialEntries: [`/posts/post-id${query}`],
      });
      await user.click(screen.getByRole("button", { name: "답글" }));
      await waitFor(() =>
        expect(
          screen.getByRole("textbox", { name: "댓글 입력" }),
        ).toHaveFocus(),
      );
      const dialog = screen.getByRole("dialog");
      const viewport = window.visualViewport;
      if (!viewport) throw new Error("visual viewport missing");

      act(() => {
        Object.assign(viewport, { height: 500, offsetTop: 100 });
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(dialog).toHaveStyle({
        top: "100px",
        height: "500px",
        bottom: "auto",
      });
      act(() => {
        Object.assign(viewport, { offsetTop: 300 });
        viewport.dispatchEvent(new Event("scroll"));
      });
      expect(dialog).toHaveStyle({
        top: "300px",
        height: "500px",
        bottom: "auto",
      });
      act(() => {
        Object.assign(viewport, { height: 800, offsetTop: 0 });
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(dialog).not.toHaveStyle({ top: "300px" });
      expect(dialog).toHaveStyle({ maxHeight: "800px" });
      expect(dialog).not.toHaveStyle({ height: "500px" });
      expect(screen.getByRole("textbox", { name: "댓글 입력" })).toHaveFocus();
    },
  );

  it("scrolls only enough to reveal a reply target after resizing", async () => {
    stubPostDetailViewport({ sheet: true });
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

  /**
   * 머리글만 끌 수 있던 때에는, 댓글을 다 읽고 목록을 맨 위로 올린 사람이 시트를 닫으려면
   * 손가락을 머리글까지 다시 가져가야 했다. 이어서 아래로 당기는 손짓으로도 닫힌다.
   */
  it("closes the comment sheet when the list is dragged down from its top", () => {
    stubPostDetailViewport({ sheet: true });
    const onClose = vi.fn();
    renderRoute(() => <Detail withComment onClose={onClose} />, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });
    const list = commentList();

    pullDown(list, 160);

    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the sheet open when the same drag starts mid-list", () => {
    stubPostDetailViewport({ sheet: true });
    const onClose = vi.fn();
    renderRoute(() => <Detail withComment onClose={onClose} />, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });
    const list = commentList();
    // 목록이 내려가 있으면 같은 손짓이 스크롤이다.
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      value: 40,
      writable: true,
    });

    pullDown(list, 160);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves the drag alone on a computer detail modal", () => {
    stubPostDetailViewport({ sheet: false });
    const onClose = vi.fn();
    renderRoute(() => <Detail withComment onClose={onClose} />, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });

    pullDown(commentList(), 160);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("focuses a mobile reply without scrolling the page", async () => {
    stubPostDetailViewport({ sheet: true });
    stubVisualViewport(800);
    const { user } = renderRoute(() => <Detail withComment />, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });
    const composer = screen.getByRole("textbox", { name: "댓글 입력" });
    const focus = vi.spyOn(composer, "focus");

    await user.click(screen.getByRole("button", { name: "답글" }));

    await waitFor(() => expect(composer).toHaveFocus());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("focuses an iPhone reply in the tap before Safari can pan the viewport", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
    stubPostDetailViewport({ sheet: true });
    stubVisualViewport(800);
    renderRoute(() => <Detail withComment />, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });
    const composer = screen.getByRole("textbox", { name: "댓글 입력" });
    const nativeFocus = composer.focus.bind(composer);
    const pan = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    vi.spyOn(composer, "focus").mockImplementation((options) => {
      // iOS may pan the viewport before emitting its keyboard resize event.
      if (composer.style.opacity !== "0") window.scrollTo(0, 500);
      nativeFocus(options);
    });

    fireEvent.click(screen.getByRole("button", { name: "답글" }));

    expect(composer).toHaveFocus();
    expect(pan).not.toHaveBeenCalled();
    await waitFor(() => expect(composer).not.toHaveStyle({ opacity: "0" }));
  });

  it("leaves Safari panning available in an unmanaged wide iPad dialog", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPad");
    stubPostDetailViewport({ sheet: false, touchPrimary: true });
    renderRoute(() => <Detail withComment />, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });
    const composer = screen.getByRole("textbox", { name: "댓글 입력" });
    const nativeFocus = composer.focus.bind(composer);
    let canPan = false;
    vi.spyOn(composer, "focus").mockImplementation((options) => {
      canPan = composer.style.opacity !== "0";
      nativeFocus(options);
    });

    fireEvent.click(screen.getByRole("button", { name: "답글" }));

    expect(composer).toHaveFocus();
    expect(canPan).toBe(true);
  });

  it("preserves native scrolling when iPhone pinch zoom disables viewport tracking", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
    stubPostDetailViewport({ sheet: true });
    stubVisualViewport(500);
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("visual viewport missing");
    Object.assign(viewport, { scale: 1.5 });
    renderRoute(() => <Detail withComment />, {
      path: "/posts/:postId",
      initialEntries: ["/posts/post-id?view=comments"],
    });
    const composer = screen.getByRole("textbox", { name: "댓글 입력" });
    const nativeFocus = composer.focus.bind(composer);
    const focus = vi.spyOn(composer, "focus").mockImplementation((options) => {
      expect(composer).not.toHaveStyle({ opacity: "0" });
      nativeFocus(options);
    });

    fireEvent.click(screen.getByRole("button", { name: "답글" }));

    expect(composer).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: false });
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
