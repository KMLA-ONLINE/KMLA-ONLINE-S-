import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeSidebarSettings } from "~/features/app-shell/components/home-sidebar-settings";

vi.mock("~/features/app-shell/hooks/use-wide-home", () => ({
  useWideHome: () => true,
}));

describe("HomeSidebarSettings", () => {
  afterEach(() => window.localStorage.clear());

  it("labels the switches in Korean by default", () => {
    render(<HomeSidebarSettings />);

    expect(
      screen.getByRole("switch", { name: "홈 우측 사이드바" }),
    ).toBeChecked();
    expect(screen.getByRole("switch", { name: "급식" })).toBeInTheDocument();
  });

  it("labels the switches in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    render(<HomeSidebarSettings />);

    expect(
      screen.getByRole("switch", { name: "Home right sidebar" }),
    ).toBeChecked();
    expect(
      screen.getByText("Applies to the desktop home in this browser."),
    ).toBeVisible();
    for (const name of ["Birthdays", "Meals", "Timetable"]) {
      expect(screen.getByRole("switch", { name })).toBeInTheDocument();
    }
  });
});
