import { describe, expect, it } from "vitest";

import { AppShellProvider, type ShellData } from "~/features/app-shell";
import { AppSidebar } from "~/features/app-shell/components/app-sidebar";
import { renderRoute, screen, within } from "../../../router";

const shell = {
  email: "student@kmla.hs.kr",
  profile: {
    id: 1,
    pub_id: "student",
    name: "홍길동",
    role: "member",
    type: "student",
    status: "accepted",
    avatar_path: null,
  },
} satisfies ShellData;

describe("desktop navigation", () => {
  it("offers home, groups and notifications without school life", () => {
    renderRoute(() => (
      <AppShellProvider value={shell}>
        <AppSidebar />
      </AppShellProvider>
    ));
    const nav = within(screen.getByRole("navigation", { name: "주요 메뉴" }));
    expect(nav.getAllByRole("link")).toHaveLength(3);
    for (const name of ["홈", "그룹", "알림"]) {
      expect(nav.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(
      nav.queryByRole("link", { name: "학교생활" }),
    ).not.toBeInTheDocument();
  });
});
