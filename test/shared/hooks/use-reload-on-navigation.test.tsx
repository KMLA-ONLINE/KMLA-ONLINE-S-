import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, Link } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { useReloadOnNavigation } from "~/shared/hooks/use-reload-on-navigation";

function renderApp(enabled: boolean) {
  const assign = vi.fn();

  function Page() {
    useReloadOnNavigation(enabled, assign);
    return (
      <>
        <Link to="/other?tab=1">다른 화면</Link>
        <Link to="/?filter=new">같은 화면</Link>
      </>
    );
  }

  // 다음 화면의 loader가 끝나지 않게 해 이동이 "loading"에 머물게 한다.
  const Stub = createRoutesStub([
    { path: "/", Component: Page, loader: () => null },
    {
      path: "/other",
      Component: () => null,
      loader: () =>
        new Promise<never>(() => {
          // 끝나지 않는다.
        }),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);

  return { assign };
}

describe("useReloadOnNavigation", () => {
  it("새 빌드가 활성화된 뒤 다른 화면으로 가면 전체 페이지로 연다", async () => {
    const { assign } = renderApp(true);

    await userEvent.click(await screen.findByText("다른 화면"));

    expect(assign).toHaveBeenCalledWith("/other?tab=1");
  });

  it("같은 경로 안의 이동은 그대로 둔다", async () => {
    const { assign } = renderApp(true);

    await userEvent.click(await screen.findByText("같은 화면"));

    expect(assign).not.toHaveBeenCalled();
  });

  it("새 빌드가 없으면 그대로 둔다", async () => {
    const { assign } = renderApp(false);

    await userEvent.click(await screen.findByText("다른 화면"));

    expect(assign).not.toHaveBeenCalled();
  });
});
