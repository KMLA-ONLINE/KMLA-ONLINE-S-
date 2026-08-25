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

function Subject({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="scroller">
      <PullToRefresh containerRef={ref} enabled onRefresh={onRefresh} />
      <div>content</div>
    </div>
  );
}

describe("PullToRefresh", () => {
  afterEach(() => vi.useRealTimers());

  it("refreshes after a downward mouse drag at the top", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Subject onRefresh={onRefresh} />);
    const scroller = screen.getByTestId("scroller");

    fireEvent.mouseDown(scroller, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.mouseMove(window, { clientX: 20, clientY: 180 });
    fireEvent.mouseUp(window);

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
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

    fireEvent.mouseDown(scroller, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.mouseMove(window, { clientX: 20, clientY: 200 });
    fireEvent.mouseUp(window);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("moves the indicator 50px below its resting position at maximum pull", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Subject onRefresh={onRefresh} />);
    const scroller = screen.getByTestId("scroller");

    fireEvent.mouseDown(scroller, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.mouseMove(window, { clientX: 20, clientY: 220 });

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
    fireEvent.mouseDown(input, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.mouseMove(window, { clientX: 20, clientY: 200 });
    fireEvent.mouseUp(window);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("keeps the refreshing status visible for at least 300ms", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Subject onRefresh={onRefresh} />);
    const scroller = screen.getByTestId("scroller");

    fireEvent.mouseDown(scroller, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.mouseMove(window, { clientX: 20, clientY: 180 });
    fireEvent.mouseUp(window);

    expect(screen.getByText("새로고침 중")).toBeVisible();
    const status = screen.getByRole("status");
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(screen.getByText("새로고침 중")).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(status).toHaveAttribute("aria-hidden", "true");
    expect(status).toHaveClass("invisible");
  });
});
