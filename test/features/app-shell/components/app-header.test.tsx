import { describe, expect, it } from "vitest";
import { redirect } from "react-router";

import { AppShellProvider, type ShellData } from "~/features/app-shell";
import { AppHeader } from "~/features/app-shell/components/app-header";
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

function renderHeader(path = "/") {
  return renderRoute(
    () => (
      <AppShellProvider value={shell}>
        <AppHeader />
      </AppShellProvider>
    ),
    {
      path,
      routes: [
        {
          path: "/logout",
          action: ({ request }) => {
            expect(request.method).toBe("POST");
            return redirect("/login");
          },
        },
        { path: "/login", Component: () => <h1>로그인 화면</h1> },
      ],
    },
  );
}

describe("AppHeader account menu", () => {
  it("leaves home school shortcuts to the page instead of the global header", () => {
    renderHeader();
    expect(
      screen.queryByRole("link", { name: "공강·노래방" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "급식" }),
    ).not.toBeInTheDocument();
  });

  it("does not add the home reservation action to another page", () => {
    renderHeader("/groups");
    expect(
      screen.queryByRole("link", { name: "공강·노래방" }),
    ).not.toBeInTheDocument();
  });
  it("requires confirmation before logging out and returns focus on cancel", async () => {
    const { user } = renderHeader();
    const avatar = screen.getByRole("button", { name: "계정 메뉴" });
    avatar.focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: "로그아웃" }));
    let dialog = await screen.findByRole("dialog", {
      name: "로그아웃하시겠습니까?",
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "로그인 화면" }),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(avatar).toHaveFocus();

    await user.click(avatar);
    await user.click(await screen.findByRole("menuitem", { name: "로그아웃" }));
    dialog = await screen.findByRole("dialog", {
      name: "로그아웃하시겠습니까?",
    });
    await user.click(within(dialog).getByRole("button", { name: "로그아웃" }));
    expect(
      await screen.findByRole("heading", { name: "로그인 화면" }),
    ).toBeInTheDocument();
  });

  it("opens profile and settings from the avatar", async () => {
    const { user } = renderHeader();
    await user.click(screen.getByRole("button", { name: "계정 메뉴" }));

    expect(
      await screen.findByRole("menuitem", { name: "내 프로필" }),
    ).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("menuitem", { name: "설정" })).toHaveAttribute(
      "href",
      "/menu/settings",
    );
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "계정 메뉴" })).toHaveFocus();
  });

  it("keeps only account actions in the avatar menu", async () => {
    const { user } = renderHeader();
    await user.click(screen.getByRole("button", { name: "계정 메뉴" }));
    expect(await screen.findAllByRole("menuitem")).toHaveLength(3);
    expect(
      screen.queryByRole("group", { name: "바로가기" }),
    ).not.toBeInTheDocument();
    for (const name of ["홈페이지", "인트라넷", "리로스쿨"]) {
      expect(screen.queryByRole("menuitem", { name })).not.toBeInTheDocument();
    }
  });
});
