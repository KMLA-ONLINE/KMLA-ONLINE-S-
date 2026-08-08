import { describe, expect, it } from "vitest";

import { renderRoute, screen } from "../../../../test/router";
import Theme from "./theme";

describe("Theme", () => {
  it("renders the complete palette in light and dark modes", () => {
    renderRoute(Theme, { path: "/theme" });

    expect(
      screen.getByRole("heading", { name: "Palette Lab" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getAllByText("primary / primary-foreground")).toHaveLength(2);
    expect(screen.getAllByText("--chart-5")).toHaveLength(2);
    expect(screen.getAllByText("--sidebar-ring")).toHaveLength(2);
  });
});
