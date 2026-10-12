import { describe, expect, it, vi } from "vitest";

import LinksPage from "~/routes/app/menu/links";
import { renderRoute, screen } from "../../../router";

describe("school links route", () => {
  it("redirects desktop visits to home", async () => {
    const original = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...original(query),
      matches: query === "(min-width: 768px)",
    }));
    renderRoute(LinksPage, {
      path: "/menu/links",
      routes: [{ path: "/", Component: () => <h1>홈 화면</h1> }],
    });
    expect(
      await screen.findByRole("heading", { name: "홈 화면" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "인트라넷" }),
    ).not.toBeInTheDocument();
  });
  it("opens each school site in a new tab", () => {
    renderRoute(LinksPage, { path: "/menu/links" });

    const expected = [
      ["민사고 홈페이지", "https://www.minjok.hs.kr/"],
      ["인트라넷", "https://old.minjok.hs.kr/members/login.php"],
      ["리로스쿨", "https://minjok.riroschool.kr/"],
    ] as const;

    for (const [name, href] of expected) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
    }
  });
});
