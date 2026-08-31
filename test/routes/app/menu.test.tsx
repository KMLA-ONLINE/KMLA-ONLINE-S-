import { describe, expect, it } from "vitest";

import {
  AppShellProvider,
  type ProfileRole,
  type ShellData,
} from "~/features/app-shell";
import MenuPage from "~/routes/app/menu";
import { renderRoute, screen } from "../../router";

function renderMenu(
  role: ProfileRole,
  type: ShellData["profile"]["type"] = "student",
) {
  const shell = {
    email: "student@kmla.hs.kr",
    profile: {
      id: 1,
      pub_id: "student",
      name: "홍길동",
      role,
      type,
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
  it("shows one admin shortcut for an admin", () => {
    renderMenu("admin");

    const links = screen.getAllByRole("link", { name: "관리자 페이지" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/admin");
  });

  it("keeps the admin shortcut away from a member", () => {
    renderMenu("member");

    expect(screen.getByRole("link", { name: "생일" })).toHaveAttribute(
      "href",
      "/menu/birthdays",
    );
    expect(
      screen.queryByRole("link", { name: "관리자 페이지" }),
    ).not.toBeInTheDocument();
  });

  it("opens every setting through one row instead of listing them", () => {
    renderMenu("member");

    expect(screen.getByRole("link", { name: "설정" })).toHaveAttribute(
      "href",
      "/menu/settings",
    );
    expect(
      screen.queryByRole("link", { name: "비밀번호 변경" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "알림 설정" }),
    ).not.toBeInTheDocument();
  });

  it("reaches the help and update pages from the menu", () => {
    renderMenu("member");

    expect(screen.getByRole("link", { name: "도움말" })).toHaveAttribute(
      "href",
      "/support",
    );
    expect(screen.getByRole("link", { name: "업데이트 기록" })).toHaveAttribute(
      "href",
      "/update",
    );
  });

  it("offers the absence shortcut to students only", () => {
    const { unmount } = renderMenu("member");

    expect(screen.getByRole("link", { name: "공결 & 병결" })).toHaveAttribute(
      "href",
      "/menu/absence",
    );

    unmount();
    renderMenu("member", "teacher");

    expect(
      screen.queryByRole("link", { name: "공결 & 병결" }),
    ).not.toBeInTheDocument();
  });
});
