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
  it.each(["/menu", "/menu/meal"])(
    "offers an active school-life entry at %s",
    (path) => {
      renderRoute(
        () => (
          <AppShellProvider value={shell}>
            <AppSidebar />
          </AppShellProvider>
        ),
        { path },
      );
      const nav = within(screen.getByRole("navigation", { name: "주요 메뉴" }));
      expect(nav.getAllByRole("link")).toHaveLength(4);
      for (const name of ["홈", "그룹", "알림"]) {
        expect(nav.getByRole("link", { name })).toBeInTheDocument();
      }
      expect(nav.getByRole("link", { name: "학교생활" })).toHaveAttribute(
        "href",
        "/menu",
      );
      expect(nav.getByRole("link", { name: "학교생활" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    },
  );
});
