import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { ErrorPage } from "~/shared/components/error-page";

function renderErrorPage(props: Parameters<typeof ErrorPage>[0]) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <ErrorPage {...props} /> },
  ]);

  return render(<Stub />);
}

describe("ErrorPage", () => {
  // 연결 문제를 서버 탓으로 안내하지 않고, 연결이 돌아오면 누르기 전에 다시 시도한다.
  it("retries a network failure once the connection comes back", () => {
    const onRetry = vi.fn();
    renderErrorPage({ network: true, onRetry });

    expect(screen.getByText("OFFLINE")).toBeInTheDocument();

    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not retry other failures on reconnect", () => {
    const onRetry = vi.fn();
    renderErrorPage({ onRetry });

    window.dispatchEvent(new Event("online"));

    expect(screen.getByText("ERROR")).toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled();
  });
});
