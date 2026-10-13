import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogoutButton } from "~/features/auth/components/logout-button";
import { clientAction } from "~/routes/auth/logout";
import { QueryProvider } from "~/shared/components/query-provider";
import { act, renderRoute, screen, waitFor, within } from "../../../router";

const auth = vi.hoisted(() => ({
  notify: undefined as
    | ((event: string, session: { user: { id: string } } | null) => void)
    | undefined,
  signOut: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: NonNullable<typeof auth.notify>) => {
        auth.notify = callback;
        callback("INITIAL_SESSION", { user: { id: "user-a" } });
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signOut: auth.signOut,
    },
  }),
}));

function Home() {
  return (
    <QueryProvider>
      <h1>홈</h1>
      <LogoutButton />
    </QueryProvider>
  );
}

function renderLogout() {
  return renderRoute(Home, {
    routes: [
      { path: "/logout", action: clientAction },
      { path: "/login", Component: () => <h1>로그인 화면</h1> },
    ],
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("logout confirmation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kmla-online:storage-owner:v1", "user-a");
    auth.signOut.mockReset();
    auth.signOut.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("reaches login even when session cleanup unmounts the dialog before logout finishes", async () => {
    const storageCleanup = deferred<boolean>();
    const signOut = deferred<{ error: null }>();
    vi.stubGlobal("caches", { delete: () => storageCleanup.promise });
    auth.signOut.mockImplementation(() => {
      auth.notify!("SIGNED_OUT", null);
      return signOut.promise;
    });
    const { user } = renderLogout();

    await user.click(await screen.findByRole("button", { name: "로그아웃" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "로그아웃" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    await act(async () => {
      signOut.resolve({ error: null });
      await signOut.promise;
    });
    await act(async () => {
      storageCleanup.resolve(true);
      await storageCleanup.promise;
    });

    expect(
      await screen.findByRole("heading", { name: "로그인 화면" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "홈" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the session when confirmation is cancelled", async () => {
    const { user } = renderLogout();

    await user.click(await screen.findByRole("button", { name: "로그아웃" }));
    await user.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "홈" })).toBeVisible();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("disables confirmation and cancellation while logout is pending", async () => {
    const signOut = deferred<{ error: null }>();
    auth.signOut.mockReturnValue(signOut.promise);
    const { user } = renderLogout();

    await user.click(await screen.findByRole("button", { name: "로그아웃" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "로그아웃" });
    await user.click(confirm);

    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "취소" })).toBeDisabled();
    await user.click(confirm);
    expect(auth.signOut).toHaveBeenCalledTimes(1);

    await act(async () => {
      signOut.resolve({ error: null });
      await signOut.promise;
    });
    expect(
      await screen.findByRole("heading", { name: "로그인 화면" }),
    ).toBeVisible();
  });
});
