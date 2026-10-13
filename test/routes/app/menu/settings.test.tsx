import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppShellProvider,
  type ProfileRole,
  type ShellData,
} from "~/features/app-shell";
import SettingsPage from "~/routes/app/menu/settings";
import { renderRoute, screen, within } from "../../../router";

afterEach(() => window.localStorage.clear());

function mockDesktop() {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === "(min-width: 1024px)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

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
    { path: "/settings" },
  );
}

describe("settings route", () => {
  it("defaults all desktop home sidebar switches to on", () => {
    mockDesktop();
    renderSettings();

    for (const name of ["홈 우측 사이드바", "생일", "급식", "시간표"]) {
      expect(screen.getByRole("switch", { name })).toBeChecked();
    }
  });

  it("hides individual switches when disabled and preserves their choices after remounting", async () => {
    mockDesktop();
    const { user, unmount } = renderSettings();
    await user.click(screen.getByRole("switch", { name: "생일" }));
    await user.click(screen.getByRole("switch", { name: "홈 우측 사이드바" }));
    for (const name of ["생일", "급식", "시간표"]) {
      expect(screen.queryByRole("switch", { name })).not.toBeInTheDocument();
    }

    unmount();
    const view = renderSettings("admin");
    expect(
      screen.getByRole("switch", { name: "홈 우측 사이드바" }),
    ).not.toBeChecked();
    await view.user.click(
      screen.getByRole("switch", { name: "홈 우측 사이드바" }),
    );
    expect(screen.getByRole("switch", { name: "생일" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "급식" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "시간표" })).toBeChecked();
  });

  it("does not expose desktop home settings on mobile", () => {
    renderSettings();
    expect(
      screen.queryByRole("switch", { name: "홈 우측 사이드바" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    "invalid JSON",
    JSON.stringify({ meal: false, birthdays: "false" }),
  ])("uses on defaults for missing or invalid choices in %s", (stored) => {
    mockDesktop();
    window.localStorage.setItem("kmla-online:home-sidebar:v1", stored);
    renderSettings();
    expect(
      screen.getByRole("switch", { name: "홈 우측 사이드바" }),
    ).toBeChecked();
    expect(screen.getByRole("switch", { name: "생일" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "시간표" })).toBeChecked();
  });

  it("hides administration from a member", () => {
    renderSettings();
    expect(
      screen.queryByRole("heading", { name: "관리" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "관리자 페이지" }),
    ).not.toBeInTheDocument();
  });

  it("groups account, app and service without administration or a profile card", () => {
    renderSettings("admin");

    for (const name of ["계정", "앱 설정", "서비스 안내"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    for (const [name, href] of [
      ["비밀번호 변경", "/settings/password"],
      ["알림 설정", "/settings/noti"],
      ["도움말", "/support"],
      ["오픈소스 라이선스", "/licenses"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(
      screen.queryByRole("heading", { name: "관리" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "관리자 페이지" }),
    ).not.toBeInTheDocument();
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
      "/settings/lab",
    );
  });
});
