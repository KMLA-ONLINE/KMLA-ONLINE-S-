import { afterEach, describe, expect, it } from "vitest";

import SupportPage from "~/routes/app/support";
import { renderRoute, screen } from "../../router";

afterEach(() => window.localStorage.clear());

describe("support route", () => {
  it("titles the screen in Korean by default", () => {
    renderRoute(SupportPage, { path: "/support" });

    expect(screen.getAllByRole("heading", { name: "도움말" })).not.toHaveLength(
      0,
    );
  });

  it("titles the screen in English when the language is English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderRoute(SupportPage, { path: "/support" });

    expect(screen.getAllByRole("heading", { name: "Help" })).not.toHaveLength(
      0,
    );
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });
});
