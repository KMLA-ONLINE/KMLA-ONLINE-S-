import { ThemeProvider } from "next-themes";
import { afterEach, describe, expect, it } from "vitest";

import SettingsLabPage from "~/routes/app/menu/settings-lab";
import { renderRoute, screen, within } from "../../../router";

const EXPERIMENTAL_FEATURES_STORAGE_KEY =
  "kmla-online:experimental-features:v1";

function renderSettingsLab() {
  return renderRoute(
    () => (
      <ThemeProvider attribute="class" defaultTheme="light">
        <SettingsLabPage />
      </ThemeProvider>
    ),
    {
      path: "/settings/lab",
      routes: [{ path: "/settings", Component: () => <h1>설정 도착</h1> }],
    },
  );
}

afterEach(() => window.localStorage.clear());

describe("settings laboratory route", () => {
  it.each([false, true])(
    "returns to settings with experimental features enabled=%s",
    async (enabled) => {
      window.localStorage.setItem(
        EXPERIMENTAL_FEATURES_STORAGE_KEY,
        String(enabled),
      );
      const { user } = renderSettingsLab();

      await user.click(screen.getByRole("button", { name: "뒤로" }));

      expect(
        await screen.findByRole("heading", { name: "설정 도착" }),
      ).toBeVisible();
    },
  );

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

describe("language setting", () => {
  it("switches the whole screen to English and stores the choice", async () => {
    window.localStorage.setItem(EXPERIMENTAL_FEATURES_STORAGE_KEY, "true");
    const { user } = renderSettingsLab();

    const group = await screen.findByRole("group", { name: "언어" });
    expect(group).toBeVisible();
    expect(screen.getByRole("button", { name: "한국어" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(window.localStorage.getItem("kmla-online:language:v1")).toBe("en");
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("group", { name: "Language" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Theme" })).toBeVisible();
    expect(screen.getAllByRole("heading", { name: "Lab" })).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("offers a system option that follows the device language", async () => {
    window.localStorage.setItem(EXPERIMENTAL_FEATURES_STORAGE_KEY, "true");
    const { user } = renderSettingsLab();

    const group = await screen.findByRole("group", { name: "언어" });
    await user.click(within(group).getByRole("button", { name: "시스템" }));

    expect(window.localStorage.getItem("kmla-online:language:v1")).toBe(
      "system",
    );
  });
});
