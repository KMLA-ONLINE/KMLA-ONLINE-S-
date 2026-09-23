import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDelayedPending } from "~/shared/hooks/use-delayed-pending";

function Subject({ pending }: { pending: boolean }) {
  const visible = useDelayedPending(pending);
  return <span>{visible ? "visible" : "hidden"}</span>;
}

describe("useDelayedPending", () => {
  afterEach(() => vi.useRealTimers());

  it("never shows for work that finishes within the delay", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<Subject pending />);

    await act(() => vi.advanceTimersByTimeAsync(100));
    rerender(<Subject pending={false} />);
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(screen.getByText("hidden")).toBeInTheDocument();
  });

  it("waits 200ms, then stays visible for at least 300ms", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<Subject pending />);

    await act(() => vi.advanceTimersByTimeAsync(199));
    expect(screen.getByText("hidden")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText("visible")).toBeInTheDocument();

    rerender(<Subject pending={false} />);
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(screen.getByText("visible")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText("hidden")).toBeInTheDocument();
  });
});
