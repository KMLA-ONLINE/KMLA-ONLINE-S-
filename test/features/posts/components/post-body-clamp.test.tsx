import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PostBodyClamp } from "~/features/posts/components/post-body-clamp";
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

  it("leaves the scroll alone when the card head is still in view", async () => {
    const { scroller, user } = renderInScroller(120);

    await user.click(screen.getByRole("button", { name: "더 보기" }));
    await user.click(screen.getByRole("button", { name: "접기" }));

    expect(scroller.scrollTop).toBe(1000);
  });
});
