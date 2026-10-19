import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub, Form, Link, Outlet } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { useDocumentNavigationAfterUpdate } from "~/shared/hooks/use-document-navigation-after-update";

// 문서 이동은 이동이 loading인 동안 일어나야 하므로, 목적지 loader가 잠시 머문다.
const pending = () => new Promise((resolve) => setTimeout(resolve, 20));

function setup() {
  const openDocument = vi.fn();
  function Shell() {
    useDocumentNavigationAfterUpdate(openDocument);
    return (
      <>
        <Link to="/posts?tab=new" state={{ from: "feed" }}>
          다른 화면
        </Link>
        <Link to="/feed?image=1">같은 화면</Link>
        <Form method="post" action="/posts">
          <button type="submit">제출</button>
        </Form>
        <Outlet />
      </>
    );
  }
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: Shell,
      children: [
        { path: "feed", Component: () => null, loader: pending },
        {
          path: "posts",
          Component: () => null,
          loader: pending,
          action: () => null,
        },
      ],
    },
  ]);
  render(<Stub initialEntries={["/feed"]} />);
  return openDocument;
}

async function click(name: string) {
  fireEvent.click(await screen.findByText(name));
  await act(async () => {
    await pending();
    await pending();
  });
}

describe("useDocumentNavigationAfterUpdate", () => {
  it("다른 화면으로 가는 이동을 state까지 담아 문서로 연다", async () => {
    const openDocument = setup();
    await click("다른 화면");

    expect(openDocument).toHaveBeenCalledTimes(1);
    expect(openDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/posts",
        search: "?tab=new",
        state: { from: "feed" },
      }),
    );
  });

  it("같은 화면 안에서 보기만 바꾸는 이동은 앱 안에 둔다", async () => {
    const openDocument = setup();
    await click("같은 화면");

    expect(openDocument).not.toHaveBeenCalled();
  });

  it("제출은 action을 건너뛰지 않도록 앱 안에 둔다", async () => {
    const openDocument = setup();
    await click("제출");

    expect(openDocument).not.toHaveBeenCalled();
  });
});
