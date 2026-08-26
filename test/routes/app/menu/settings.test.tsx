import { afterEach, describe, expect, it } from "vitest";

import SettingsPage from "~/routes/app/menu/settings";
import { renderRoute, screen } from "../../../router";

afterEach(() => window.localStorage.clear());

describe("settings route", () => {
  it("stores the experimental-features choice and reveals the laboratory link", async () => {
    const { user } = renderRoute(SettingsPage, { path: "/menu/settings" });

    expect(
      screen.queryByRole("link", { name: "실험실 설정" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "실험실 기능 사용" }));

    expect(
      window.localStorage.getItem("kmla-online:experimental-features:v1"),
    ).toBe("true");
    expect(screen.getByRole("link", { name: "실험실 설정" })).toHaveAttribute(
      "href",
      "/menu/settings/lab",
    );
  });
});
