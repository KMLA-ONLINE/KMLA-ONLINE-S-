import { describe, expect, it } from "vitest";

import {
  AppShellProvider,
  type ProfileRole,
  type ShellData,
} from "~/features/app-shell";
import MenuPage from "~/routes/app/menu";
import { renderRoute, screen } from "../../router";

function renderMenu(role: ProfileRole) {
  const shell = {
    email: "student@kmla.hs.kr",
    profile: {
      id: 1,
      pub_id: "student",
      name: "홍길동",
      role,
      type: "student",
      status: "accepted",
      avatar_url: null,
    },
    badges: {},
  } satisfies ShellData;

  return renderRoute(
    () => (
      <AppShellProvider value={shell}>
        <MenuPage />
      </AppShellProvider>
    ),
    { path: "/menu" },
  );
}

describe("menu route", () => {
  it("links to the birthday list", () => {
    renderMenu("member");

    expect(screen.getByRole("link", { name: "생일" })).toHaveAttribute(
      "href",
      "/menu/birthdays",
    );
  });

  it("shows one admin shortcut for an admin", () => {
    renderMenu("admin");

    expect(screen.getByRole("heading", { name: "관리자" })).toBeVisible();
    const links = screen.getAllByRole("link", { name: "관리자 페이지" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/admin");
  });

  it("does not show the admin shortcut for a member", () => {
    renderMenu("member");

    expect(
      screen.queryByRole("heading", { name: "관리자" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "관리자 페이지" }),
    ).not.toBeInTheDocument();
  });
});
