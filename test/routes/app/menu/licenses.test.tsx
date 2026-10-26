import { afterEach, describe, expect, it } from "vitest";

import LicensesPage from "~/routes/app/menu/licenses";
import { renderRoute, screen } from "../../../router";

afterEach(() => window.localStorage.clear());

describe("licenses route", () => {
  it("titles the screen in Korean by default", () => {
    renderRoute(LicensesPage, { path: "/licenses" });

    expect(
      screen.getAllByRole("heading", { name: "오픈소스 라이선스" }),
    ).not.toHaveLength(0);
  });

  it("titles the screen in English when the language is English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderRoute(LicensesPage, { path: "/licenses" });

    expect(
      screen.getAllByRole("heading", { name: "Open source licenses" }),
    ).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });
  it("shows the license notes in English when the language is English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderRoute(LicensesPage, { path: "/licenses" });

    expect(screen.getByText(/Emoji graphics use/)).toBeInTheDocument();
    expect(
      screen.getByText(/HEIC\/HEIF image conversion uses/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Twemoji" })).toHaveAttribute(
      "href",
      "https://github.com/jdecked/twemoji",
    );
  });
});
