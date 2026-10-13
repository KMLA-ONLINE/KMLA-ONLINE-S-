import { describe, expect, it, vi } from "vitest";

import {
  AppShellProvider,
  type ProfileRole,
  type ShellData,
} from "~/features/app-shell";
import MenuPage from "~/routes/app/menu";
import { renderRoute, screen, within } from "../../router";

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
      avatar_path: null,
    },
  } satisfies ShellData;

  return renderRoute(
    () => (
      <AppShellProvider value={shell}>
        <MenuPage />
      </AppShellProvider>
    ),
    {
      path: "/menu",
      routes: [{ path: "/", Component: () => <h1>홈 화면</h1> }],
    },
  );
}

describe("menu route", () => {
  it("keeps the desktop school-life entry on the menu screen", () => {
    const original = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...original(query),
      matches: query === "(min-width: 768px)",
    }));
    renderMenu("member");
    expect(
      screen.queryByRole("heading", { name: "홈 화면" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "학교생활 기능" }),
    ).toBeInTheDocument();
  });
  it("keeps school tools in the body and account entry points in the header", () => {
    renderMenu("admin");

    expect(screen.getAllByRole("heading", { name: "메뉴" })).toHaveLength(2);
    const tools = within(
      screen.getByRole("navigation", { name: "학교생활 기능" }),
    );
    expect(tools.getAllByRole("link")).toHaveLength(5);
    for (const [name, href] of [
      ["급식", "/menu/meal"],
      ["시간표", "/menu/timetable"],
      ["공강 · 노래방", "/menu/gongang"],
      ["생일", "/menu/birthdays"],
      ["기부물품", "/menu/donations"],
    ]) {
      expect(tools.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(screen.getByRole("link", { name: "설정" })).toHaveAttribute(
      "href",
      "/menu/settings",
    );
    expect(screen.getByRole("link", { name: "내 프로필" })).toHaveAttribute(
      "href",
      "/profile",
    );
    for (const name of [
      "관리자 페이지",
      "도움말",
      "업데이트 기록",
      "오픈소스 라이선스",
      "비밀번호 변경",
      "알림 설정",
    ]) {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: "로그아웃" }),
    ).not.toBeInTheDocument();
  });
  it("opens school sites directly from a separate menu section in new tabs", () => {
    renderMenu("member");

    expect(
      screen.getByRole("heading", { name: "학교 기능" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "학교 사이트" }),
    ).toBeInTheDocument();
    const sites = within(
      screen.getByRole("navigation", { name: "학교 사이트" }),
    );
    expect(sites.getAllByRole("link")).toHaveLength(3);
    for (const [name, href] of [
      ["홈페이지", "https://www.minjok.hs.kr/"],
      ["인트라넷", "https://old.minjok.hs.kr/members/login.php"],
      ["리로스쿨", "https://minjok.riroschool.kr/"],
    ]) {
      const link = sites.getByRole("link", { name: `${name} (새 탭)` });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
    expect(
      screen.queryByRole("link", { name: "바로가기" }),
    ).not.toBeInTheDocument();
  });
});
