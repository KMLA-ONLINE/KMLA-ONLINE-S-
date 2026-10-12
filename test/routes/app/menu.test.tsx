import { describe, expect, it } from "vitest";

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
    { path: "/menu" },
  );
}

describe("menu route", () => {
  it("keeps school tools in the body and account entry points in the header", () => {
    renderMenu("admin");

    expect(screen.getAllByRole("heading", { name: "학교생활" })).toHaveLength(
      2,
    );
    const tools = within(
      screen.getByRole("navigation", { name: "학교생활 기능" }),
    );
    expect(tools.getAllByRole("link")).toHaveLength(5);
    for (const [name, href] of [
      ["급식", "/menu/meal"],
      ["시간표", "/menu/timetable"],
      ["공강 · 노래방", "/util/gongang"],
      ["생일", "/menu/birthdays"],
      ["바로가기", "/menu/links"],
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
});
