import { afterEach, describe, expect, it } from "vitest";

import { AppShellProvider, type ShellData } from "~/features/app-shell";
import AdminHubPage from "~/routes/app/admin/index";
import LicensesPage from "~/routes/app/menu/licenses";
import SettingsPage from "~/routes/app/menu/settings";
import SupportPage from "~/routes/app/support";
import { renderRoute, screen } from "../../router";

const SHELL = {
  email: "student@kmla.hs.kr",
  profile: {
    id: 1,
    pub_id: "student",
    name: "홍길동",
    role: "admin",
    type: "student",
    status: "accepted",
    avatar_path: null,
    terms_agreed_at: "2026-10-20T00:00:00+00:00",
  },
} satisfies ShellData;

afterEach(() => window.localStorage.clear());

describe("settings return navigation", () => {
  it("preserves the settings first page return to menu", async () => {
    const { user } = renderRoute(
      () => (
        <AppShellProvider value={SHELL}>
          <SettingsPage />
        </AppShellProvider>
      ),
      {
        path: "/settings",
        routes: [{ path: "/menu", Component: () => <h1>메뉴 도착</h1> }],
      },
    );

    await user.click(screen.getByRole("button", { name: "뒤로" }));

    expect(
      await screen.findByRole("heading", { name: "메뉴 도착" }),
    ).toBeVisible();
  });

  it("returns from the admin hub to menu", async () => {
    const { user } = renderRoute(
      () => (
        <AppShellProvider value={SHELL}>
          <AdminHubPage />
        </AppShellProvider>
      ),
      {
        path: "/admin",
        routes: [{ path: "/menu", Component: () => <h1>메뉴 도착</h1> }],
      },
    );

    await user.click(screen.getByRole("button", { name: "뒤로" }));

    expect(
      await screen.findByRole("heading", { name: "메뉴 도착" }),
    ).toBeVisible();
  });

  it("returns from support directly to settings", async () => {
    const { user } = renderRoute(SupportPage, {
      path: "/support",
      routes: [{ path: "/settings", Component: () => <h1>설정 도착</h1> }],
    });

    await user.click(screen.getByRole("button", { name: "뒤로" }));

    expect(
      await screen.findByRole("heading", { name: "설정 도착" }),
    ).toBeVisible();
  });

  it("returns from licenses directly to settings", async () => {
    const { user } = renderRoute(LicensesPage, {
      path: "/licenses",
      routes: [{ path: "/settings", Component: () => <h1>설정 도착</h1> }],
    });

    await user.click(screen.getByRole("button", { name: "뒤로" }));

    expect(
      await screen.findByRole("heading", { name: "설정 도착" }),
    ).toBeVisible();
  });
});
