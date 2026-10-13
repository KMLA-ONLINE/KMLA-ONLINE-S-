import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useServiceWorkerNavigation } from "~/shared/hooks/use-service-worker-navigation";
import { renderRoute, screen } from "../../router";

const container = new EventTarget();
Object.defineProperty(navigator, "serviceWorker", {
  configurable: true,
  value: container,
});

afterEach(() => vi.restoreAllMocks());

function request(data: unknown) {
  const reply = vi.fn();
  act(() => {
    const event = new MessageEvent("message", { data });
    // jsdom의 MessageEvent는 실제 MessagePort만 받으므로 답장 포트를 덮어 둔다.
    Object.defineProperty(event, "ports", {
      value: [{ postMessage: reply }],
    });
    container.dispatchEvent(event);
  });
  return reply;
}

describe("useServiceWorkerNavigation", () => {
  it("알림 클릭의 이동 요청을 앱 안에서 처리하고 받았다고 답한다", async () => {
    function Listener() {
      useServiceWorkerNavigation();
      return <p>피드</p>;
    }
    renderRoute(Listener, {
      path: "/",
      routes: [{ path: "/messenger/:roomId", Component: () => <p>대화방</p> }],
    });

    const reply = request({ type: "navigate", path: "/messenger/abc" });

    expect(await screen.findByText("대화방")).toBeInTheDocument();
    expect(reply).toHaveBeenCalledWith("navigated");
  });

  it("다른 출처로 가는 경로는 받지 않는다", () => {
    function Listener() {
      useServiceWorkerNavigation();
      return <p>피드</p>;
    }
    renderRoute(Listener, { path: "/" });

    const reply = request({ type: "navigate", path: "//evil.example/x" });

    expect(reply).not.toHaveBeenCalled();
    expect(screen.getByText("피드")).toBeInTheDocument();
  });
});
