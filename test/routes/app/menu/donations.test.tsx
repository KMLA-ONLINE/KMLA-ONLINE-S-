import { afterEach, describe, expect, it, vi } from "vitest";

import DonationsPage from "~/routes/app/menu/donations";
import { renderRoute, screen } from "../../../router";

vi.mock("~/features/donations", () => ({
  DonationsScreen: () => <div>screen</div>,
}));

afterEach(() => window.localStorage.clear());

describe("donations route", () => {
  it("titles the screen in Korean by default", () => {
    renderRoute(DonationsPage, { path: "/menu/donations" });

    expect(
      screen.getAllByRole("heading", { name: "기부물품" }),
    ).not.toHaveLength(0);
  });

  it("titles the screen in English when the language is English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderRoute(DonationsPage, { path: "/menu/donations" });

    expect(
      screen.getAllByRole("heading", { name: "Donations" }),
    ).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });
});
