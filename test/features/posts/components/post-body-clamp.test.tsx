import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collapseAllPostBodies,
  PostBodyClamp,
} from "~/features/posts/components/post-body-clamp";
import { ScrollContainerContext } from "~/shared/lib/scroll-container";

/**
 * jsdom은 레이아웃이 없다. 본문이 잘렸다는 것과, 접은 뒤 카드 머리가 스크롤 영역 위로
 * `cardTop`만큼 밀려나 있다는 것만 넣어 준다.
 */
function renderInScroller(cardTop: number) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(72);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return { top: this.tagName === "ARTICLE" ? cardTop : 0 } as DOMRect;
    },
  );

  const scroller = document.createElement("main");
  document.body.append(scroller);
  scroller.scrollTop = 1000;

  render(
    <ScrollContainerContext value={{ current: scroller }}>
      <article>
        <PostBodyClamp>
          <p>긴 본문</p>
        </PostBodyClamp>
      </article>
    </ScrollContainerContext>,
    { container: scroller },
  );
  return { scroller, user: userEvent.setup() };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("PostBodyClamp", () => {
  it("brings the card head back when collapsing after reading past it", async () => {
    const { scroller, user } = renderInScroller(-600);

    await user.click(screen.getByRole("button", { name: "더 보기" }));
    await user.click(screen.getByRole("button", { name: "접기" }));

    expect(scroller.scrollTop).toBe(400);
  });

  it("keeps a post expanded across remounts so restored scroll lines up", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(72);
    const user = userEvent.setup();
    const body = (
      <PostBodyClamp postId="remount-post">
        <p>긴 본문</p>
      </PostBodyClamp>
    );

    const { unmount } = render(body);
    await user.click(screen.getByRole("button", { name: "더 보기" }));
    unmount();

    render(body);
    expect(screen.getByRole("button", { name: "접기" })).toBeInTheDocument();
  });

  it("re-measures an expanded post after its body was edited shorter", async () => {
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(72);
    const user = userEvent.setup();
    const { unmount } = render(
      <PostBodyClamp postId="edited-post">
        <p>긴 본문</p>
      </PostBodyClamp>,
    );
    await user.click(screen.getByRole("button", { name: "더 보기" }));
    unmount();

    scrollHeight.mockReturnValue(48);
    render(
      <PostBodyClamp postId="edited-post">
        <p>짧은 본문</p>
      </PostBodyClamp>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the clamp button on the first render when the post was measured before", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(72);
    const body = (
      <PostBodyClamp postId="measured-post">
        <p>긴 본문</p>
      </PostBodyClamp>
    );
    render(body).unmount();

    // 측정이 다시 돌기 전 첫 렌더 결과만 본다.
    expect(renderToString(body)).toContain("더 보기");
  });

  it("collapses mounted and remembered posts on pull-to-refresh", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(72);
    const user = userEvent.setup();
    render(
      <PostBodyClamp postId="refreshed-post">
        <p>긴 본문</p>
      </PostBodyClamp>,
    );
    await user.click(screen.getByRole("button", { name: "더 보기" }));

    act(() => collapseAllPostBodies());

    expect(screen.getByRole("button", { name: "더 보기" })).toBeInTheDocument();
  });

  it("leaves the scroll alone when the card head is still in view", async () => {
    const { scroller, user } = renderInScroller(120);

    await user.click(screen.getByRole("button", { name: "더 보기" }));
    await user.click(screen.getByRole("button", { name: "접기" }));

    expect(scroller.scrollTop).toBe(1000);
  });
});
