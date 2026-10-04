import { ThemeProvider } from "next-themes";
import { afterEach, describe, expect, it } from "vitest";

import SettingsLabPage from "~/routes/app/menu/settings-lab";
import { renderRoute, screen } from "../../../router";

const EXPERIMENTAL_FEATURES_STORAGE_KEY =
  "kmla-online:experimental-features:v1";

function renderSettingsLab() {
  return renderRoute(
    () => (
      <ThemeProvider attribute="class" defaultTheme="light">
        <SettingsLabPage />
      </ThemeProvider>
    ),
    { path: "/menu/settings/lab" },
  );
}

afterEach(() => window.localStorage.clear());

describe("settings laboratory route", () => {
  it("does not expose experimental settings while disabled", () => {
    renderSettingsLab();

    expect(
      screen.getByText("실험실 기능을 켜면 설정을 사용할 수 있습니다."),
    ).toBeVisible();
    expect(
      screen.queryByRole("group", { name: "게시물 보기 방식" }),
    ).not.toBeInTheDocument();
  });

  it("shows the unfinished post and theme settings while enabled", async () => {
    window.localStorage.setItem(EXPERIMENTAL_FEATURES_STORAGE_KEY, "true");
    const { user } = renderSettingsLab();

    expect(
      await screen.findByRole("group", { name: "게시물 보기 방식" }),
    ).toBeVisible();
    expect(screen.getByRole("group", { name: "테마" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "목록" }));
    expect(screen.getByRole("button", { name: "목록" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(window.localStorage.getItem("kmla-online:posts-view:v1")).toBe(
      "list",
    );

    await user.click(screen.getByRole("button", { name: "다크" }));
    expect(document.documentElement).toHaveClass("dark");
  });
});
