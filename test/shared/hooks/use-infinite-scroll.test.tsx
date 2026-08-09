import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInfiniteScroll } from "~/shared/hooks/use-infinite-scroll";
import { ScrollContainerContext } from "~/shared/lib/scroll-container";

let observers: { callback: IntersectionObserverCallback; root: unknown }[];

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds = [0];

  constructor(
    callback: IntersectionObserverCallback,
    init?: IntersectionObserverInit,
  ) {
    this.root = (init?.root as Element | null) ?? null;
    this.rootMargin = init?.rootMargin ?? "0px";
    observers.push({ callback, root: this.root });
  }

  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = vi.fn(() => []);
  unobserve = vi.fn();
}

function Harness({
  onLoadMore,
  enabled = true,
  pending = false,
}: {
  onLoadMore: () => void;
  enabled?: boolean;
  pending?: boolean;
}) {
  const sentinelRef = useInfiniteScroll(onLoadMore, { enabled, pending });
  return <div ref={sentinelRef} />;
}

function notify(isIntersecting: boolean) {
  const observer = observers.at(-1);
  if (!observer) throw new Error("observer was not created");

  act(() => {
    observer.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

describe("useInfiniteScroll", () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("같은 교차 상태에서는 한 번만 호출하고, 벗어난 뒤 다시 호출한다", () => {
    const onLoadMore = vi.fn();
    render(<Harness onLoadMore={onLoadMore} />);

    notify(true);
    notify(true);
    expect(onLoadMore).toHaveBeenCalledOnce();

    notify(false);
    notify(true);
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("pending 동안 관찰하지 않고, 끝나면 다시 관찰한다", () => {
    const onLoadMore = vi.fn();
    const view = render(<Harness onLoadMore={onLoadMore} pending />);
    expect(observers).toHaveLength(0);

    view.rerender(<Harness onLoadMore={onLoadMore} pending={false} />);
    notify(true);
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("셸 밖에서는 뷰포트를 root로 쓴다", () => {
    render(<Harness onLoadMore={vi.fn()} />);
    expect(observers.at(-1)?.root).toBeNull();
  });

  it("셸 안에서는 스크롤 영역을 root로 쓴다", () => {
    const scrollRef = createRef<HTMLElement>();
    const container = document.createElement("main");
    scrollRef.current = container;

    render(
      <ScrollContainerContext value={scrollRef}>
        <Harness onLoadMore={vi.fn()} />
      </ScrollContainerContext>,
    );

    expect(observers.at(-1)?.root).toBe(container);
  });
});
