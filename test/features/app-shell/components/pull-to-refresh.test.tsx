import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PullToRefresh } from "~/features/app-shell/components/pull-to-refresh";

const TOUCH_ID = 1;

function beginPull(scroller: HTMLElement) {
  fireEvent.touchStart(scroller, {
    touches: [{ identifier: TOUCH_ID, clientX: 20, clientY: 20 }],
  });
}

function movePull(scroller: HTMLElement, clientY: number) {
  fireEvent.touchMove(scroller, {
    touches: [{ identifier: TOUCH_ID, clientX: 20, clientY }],
  });
}

function finishPull(scroller: HTMLElement) {
  fireEvent.touchEnd(scroller);
}

function Subject({
  onRefresh,
  onButtonClick,
}: {
  onRefresh: () => Promise<void>;
  onButtonClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="scroller">
      <PullToRefresh containerRef={ref} enabled onRefresh={onRefresh} />
      <div>content</div>
      <button type="button" onClick={onButtonClick}>
        action
      </button>
    </div>
  );
}

describe("PullToRefresh", () => {
  afterEach(() => vi.useRealTimers());

  it("refreshes after a downward touch drag at the top", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Subject onRefresh={onRefresh} />);
    const scroller = screen.getByTestId("scroller");

    beginPull(scroller);
    movePull(scroller, 180);
    finishPull(scroller);

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it("does not refresh after a mouse drag", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Subject onRefresh={onRefresh} />);
    const scroller = screen.getByTestId("scroller");

    fireEvent.mouseDown(scroller, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.mouseMove(window, { clientX: 20, clientY: 180 });
    fireEvent.mouseUp(window);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not start while the container is scrolled", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Subject onRefresh={onRefresh} />);
    const scroller = screen.getByTestId("scroller");
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      value: 10,
      writable: true,
    });

    beginPull(scroller);
    movePull(scroller, 200);
    finishPull(scroller);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("moves the indicator 50px below its resting position at maximum pull", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Subject onRefresh={onRefresh} />);
    const scroller = screen.getByTestId("scroller");

    beginPull(scroller);
    movePull(scroller, 220);

    expect(screen.getByTestId("pull-to-refresh-indicator")).toHaveStyle({
      transform: "translateY(50px)",
    });
  });

  it("ignores gestures that begin in an input", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    function InputSubject() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div ref={ref} data-testid="scroller">
          <PullToRefresh containerRef={ref} enabled onRefresh={onRefresh} />
          <input aria-label="search" />
        </div>
      );
    }

    render(<InputSubject />);
    const input = screen.getByLabelText("search");
    beginPull(input);
    movePull(input, 200);
    finishPull(input);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("swallows the click right after a pull but not a later tap", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onButtonClick = vi.fn();
    render(<Subject onRefresh={onRefresh} onButtonClick={onButtonClick} />);
    const scroller = screen.getByTestId("scroller");
    const button = screen.getByRole("button", { name: "action" });

    beginPull(scroller);
    movePull(scroller, 180);
    finishPull(scroller);
    fireEvent.click(button);
    expect(onButtonClick).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));

    // 끌고 떼면 브라우저가 click을 보내지 않는 경우가 많다. 그래도 새로고침이 끝난 뒤의 탭은
    // 먹히지 않아야 한다.
    beginPull(scroller);
    movePull(scroller, 180);
    finishPull(scroller);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    fireEvent.click(button);
    expect(onButtonClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the refreshing status visible for at least 300ms", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Subject onRefresh={onRefresh} />);
    const scroller = screen.getByTestId("scroller");

    beginPull(scroller);
    movePull(scroller, 180);
    finishPull(scroller);

    expect(screen.getByText("새로고침 중")).toBeVisible();
    const status = screen.getByRole("status");
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(screen.getByText("새로고침 중")).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(status).toHaveAttribute("aria-hidden", "true");
    expect(status).toHaveClass("invisible");
  });
});
