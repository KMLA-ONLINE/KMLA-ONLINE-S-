import { matchRoutes, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";

import routes from "~/routes";
import PrivacyPolicyPage from "~/routes/legal/privacy-policy";
import TermsOfServicePage from "~/routes/legal/terms-of-service";
import { renderRoute, screen } from "../router";

describe("legal documents", () => {
  // 가입 전에도 읽어야 하므로 인증 게이트 밖에 둔다.
  it("serves both documents outside the sign-in gate", () => {
    for (const [path, file] of [
      ["/terms-of-service", "routes/legal/terms-of-service.tsx"],
      ["/privacy-policy", "routes/legal/privacy-policy.tsx"],
    ]) {
      const matches = matchRoutes(routes as RouteObject[], path);
      expect(
        matches?.map(({ route }) => "file" in route && route.file),
      ).toEqual([file]);
    }
  });

  it("shows the terms of service in effect", async () => {
    renderRoute(TermsOfServicePage, { path: "/terms-of-service" });

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "KMLA Online 이용약관",
      }),
    ).toBeVisible();
    expect(screen.getByText("시행일: 2026년 10월 20일")).toBeVisible();
  });

  it("links the privacy policy's contents to its sections", async () => {
    renderRoute(PrivacyPolicyPage, { path: "/privacy-policy" });

    const link = await screen.findByRole("link", {
      name: "처리하는 개인정보의 항목",
    });
    const target = document.getElementById(
      decodeURIComponent(link.getAttribute("href")!.slice(1)),
    );
    expect(target).toHaveTextContent("2. 처리하는 개인정보의 항목");
  });
});
