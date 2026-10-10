import { describe, expect, it } from "vitest";

import LinksPage from "~/routes/app/menu/links";
import { renderRoute, screen } from "../../../router";

describe("school links route", () => {
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
