import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, Link, Outlet, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { useReloadOnNavigation } from "~/shared/hooks/use-reload-on-navigation";

function renderApp(enabled: boolean, { stuck = false } = {}) {
  const reload = vi.fn();
  let pending: ReturnType<typeof useReloadOnNavigation> | null = null;

  // 실제처럼 이동해도 내려가지 않는 루트에 둔다.
  function Shell() {
    pending = useReloadOnNavigation(enabled, reload);
    return <Outlet />;
  }

  function Page() {
    const { pathname, search, state } = useLocation();
    return (
      <>
        <p>
          {pathname}
          {search}
          {state ? " with state" : ""}
        </p>
        <Link to="/other?tab=1" state={{ from: "home" }}>
          다른 화면
        </Link>
        <Link to="/?filter=new">같은 화면</Link>
      </>
    );
  }

  const Stub = createRoutesStub([
    {
      Component: Shell,
      children: [
        { path: "/", Component: Page },
        {
          path: "/other",
          Component: Page,
          // 옛 청크가 사라져 이동이 "loading"에서 멈춘 상황을 흉내 낸다.
          loader: stuck
            ? () =>
                new Promise<never>(() => {
                  // 끝나지 않는다.
                })
            : () => null,
        },
      ],
    },
  ]);

  render(<Stub initialEntries={["/"]} />);

  return { reload, pending: () => pending?.current ?? null };
}

describe("useReloadOnNavigation", () => {
  it("새 빌드가 활성화된 뒤 다른 화면에 도착하면 새로고침한다", async () => {
    const { reload } = renderApp(true);

    await userEvent.click(await screen.findByText("다른 화면"));

    // 이동은 끝까지 간다. 새로고침이 기록 항목과 state를 그대로 쓴다.
    expect(await screen.findByText("/other?tab=1 with state")).toBeVisible();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("같은 경로 안의 이동은 그대로 둔다", async () => {
    const { reload } = renderApp(true);

    await userEvent.click(await screen.findByText("같은 화면"));

    expect(await screen.findByText("/?filter=new")).toBeVisible();
    expect(reload).not.toHaveBeenCalled();
  });

  it("도착한 화면에 미저장 입력이 있으면 미룬다", async () => {
    const { reload } = renderApp(true);
    const input = document.createElement("input");
    input.value = "입력 중";
    document.body.append(input);

    await userEvent.click(await screen.findByText("다른 화면"));

    expect(await screen.findByText("/other?tab=1 with state")).toBeVisible();
    expect(reload).not.toHaveBeenCalled();
    input.remove();
  });

  it("새 빌드가 없으면 그대로 둔다", async () => {
    const { reload } = renderApp(false);

    await userEvent.click(await screen.findByText("다른 화면"));

    expect(await screen.findByText("/other?tab=1 with state")).toBeVisible();
    expect(reload).not.toHaveBeenCalled();
  });

  it("진행 중인 이동의 목적지를 알려 준다", async () => {
    const { pending } = renderApp(true, { stuck: true });

    await userEvent.click(await screen.findByText("다른 화면"));

    await vi.waitFor(() =>
      expect(pending()).toMatchObject({
        pathname: "/other",
        search: "?tab=1",
        state: { from: "home" },
      }),
    );
  });
});
