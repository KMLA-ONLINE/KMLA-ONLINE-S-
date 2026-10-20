import { render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { createRoutesStub, Outlet, redirect, useSubmit } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QueryProvider } from "~/shared/components/query-provider";
import { resetQueryClientForTests } from "~/shared/lib/query-client";
import { act } from "../../router";

const auth = vi.hoisted(() => ({
  notify: undefined as
    | ((event: string, session: { user: { id: string } } | null) => void)
    | undefined,
}));

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: NonNullable<typeof auth.notify>) => {
        auth.notify = callback;
        callback("INITIAL_SESSION", { user: { id: "user-a" } });
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("QueryProvider", () => {
  beforeEach(() => {
    resetQueryClientForTests();
    window.localStorage.setItem("kmla-online:storage-owner:v1", "user-a");
    vi.stubGlobal("caches", { delete: () => Promise.resolve(true) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("does not remount the signed-in screen while the logout redirect is still loading", async () => {
    const logoutRequest = deferred<void>();
    const loginLoader = deferred<null>();
    const loadLogin = vi.fn(() => loginLoader.promise);
    let homeMounts = 0;

    // 화면이 마운트될 때마다 셸 쿼리처럼 요청을 띄운다고 보고 마운트 횟수를 센다.
    // 첫 마운트는 act 밖의 저장소 동기화 뒤에 커밋되어 passive effect가 `findByRole`보다
    // 늦게 돌 수 있으므로, DOM과 같은 커밋에서 도는 layout effect로 센다.
    function Home() {
      const submit = useSubmit();
      useLayoutEffect(() => {
        homeMounts += 1;
      }, []);
      return (
        <button
          type="button"
          onClick={() =>
            void submit(null, { method: "post", action: "/logout" })
          }
        >
          로그아웃
        </button>
      );
    }

    const Stub = createRoutesStub([
      {
        // `app/root.tsx`처럼 provider가 모든 route 위에 있다.
        Component: () => (
          <QueryProvider>
            <Outlet />
          </QueryProvider>
        ),
        children: [
          { path: "/", Component: Home },
          {
            path: "/logout",
            // supabase-js는 서버 `/logout` 응답을 받은 뒤에 `SIGNED_OUT`을 알린다.
            action: async () => {
              await logoutRequest.promise;
              auth.notify!("SIGNED_OUT", null);
              return redirect("/login");
            },
          },
          {
            path: "/login",
            loader: loadLogin,
            Component: () => <h1>로그인 화면</h1>,
          },
        ],
      },
    ]);
    render(<Stub />);

    const logout = await screen.findByRole("button", { name: "로그아웃" });
    expect(homeMounts).toBe(1);
    // auth 응답을 풀기 전에 라우터의 submitting transition과 effect를 반영한다.
    await act(async () => {
      logout.click();
      await Promise.resolve();
    });
    await act(async () => {
      logoutRequest.resolve();
      await logoutRequest.promise;
    });

    // 고정 시간 대신 저장소 정리와 redirect 시작을 기다린다. loader는 계속 보류한다.
    await waitFor(() => {
      expect(
        window.localStorage.getItem("kmla-online:storage-owner:v1"),
      ).toBeNull();
    });
    await waitFor(() => expect(loadLogin).toHaveBeenCalledOnce());
    expect(homeMounts).toBe(1);
    expect(
      screen.queryByRole("button", { name: "로그아웃" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      loginLoader.resolve(null);
      await loginLoader.promise;
    });
    expect(
      await screen.findByRole("heading", { name: "로그인 화면" }),
    ).toBeVisible();
    expect(homeMounts).toBe(1);
  });

  it("shows the screen again when the account changes without a navigation", async () => {
    const Stub = createRoutesStub([
      {
        Component: () => (
          <QueryProvider>
            <Outlet />
          </QueryProvider>
        ),
        children: [{ path: "/", Component: () => <h1>홈</h1> }],
      },
    ]);
    render(<Stub />);
    expect(await screen.findByRole("heading", { name: "홈" })).toBeVisible();

    // 다른 탭에서 로그아웃하면 이 탭에는 navigation 없이 `SIGNED_OUT`만 온다.
    act(() => auth.notify!("SIGNED_OUT", null));

    expect(await screen.findByRole("heading", { name: "홈" })).toBeVisible();
  });
});
