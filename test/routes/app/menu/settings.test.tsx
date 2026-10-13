import { afterEach, describe, expect, it } from "vitest";

import {
  AppShellProvider,
  type ProfileRole,
  type ShellData,
} from "~/features/app-shell";
import SettingsPage from "~/routes/app/menu/settings";
import { renderRoute, screen, within } from "../../../router";

afterEach(() => window.localStorage.clear());

function renderSettings(role: ProfileRole = "member") {
  const shell = {
    email: "student@kmla.hs.kr",
    profile: {
      id: 1,
      pub_id: "student",
      name: "홍길동",
      role,
      type: "student",
      status: "accepted",
      avatar_path: null,
    },
  } satisfies ShellData;
  return renderRoute(
    () => (
      <AppShellProvider value={shell}>
        <SettingsPage />
      </AppShellProvider>
    ),
    { path: "/menu/settings" },
  );
}

describe("settings route", () => {
  it("hides administration from a member", () => {
    renderSettings();
    expect(
      screen.queryByRole("heading", { name: "관리" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "관리자 페이지" }),
    ).not.toBeInTheDocument();
  });

  it("groups account, app, service and administration without a profile card", () => {
    renderSettings("admin");

    for (const name of ["계정", "앱 설정", "서비스 안내", "관리"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    for (const [name, href] of [
      ["비밀번호 변경", "/menu/password"],
      ["알림 설정", "/noti/settings"],
      ["도움말", "/support"],
      ["오픈소스 라이선스", "/menu/licenses"],
      ["관리자 페이지", "/admin"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(
      within(screen.getByRole("region", { name: "서비스 안내" })).getByRole(
        "region",
        { name: "앱 버전" },
      ),
    ).toBeInTheDocument();
    // 로그아웃은 계정 카드 안이 아니라 맨 아래에 따로 둔다.
    expect(
      within(screen.getByRole("region", { name: "계정" })).queryByRole(
        "button",
        { name: "로그아웃" },
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "로그아웃" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "내 프로필" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "바로가기" }),
    ).not.toBeInTheDocument();
  });

  it("stores the experimental-features choice and reveals the laboratory link", async () => {
    const { user } = renderSettings();

    expect(
      screen.queryByRole("link", { name: "실험실 설정" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "실험실 기능 사용" }));

    expect(
      window.localStorage.getItem("kmla-online:experimental-features:v1"),
    ).toBe("true");
    expect(screen.getByRole("link", { name: "실험실 설정" })).toHaveAttribute(
      "href",
      "/menu/settings/lab",
    );
  });
});
