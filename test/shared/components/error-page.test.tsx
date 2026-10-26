import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("ErrorPage in English", () => {
  afterEach(() => window.localStorage.clear());

  it("offers the actions in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderErrorPage({ status: 404, onRetry: vi.fn() });

    expect(screen.getByRole("button", { name: "Back to home" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
