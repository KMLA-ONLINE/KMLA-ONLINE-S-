import { describe, expect, it } from "vitest";

import { renderRoute, screen } from "../../test/router";
import Home from "./home";

describe("Home", () => {
  it("reports a healthy Supabase connection", async () => {
    renderRoute(Home, {
      hydrationData: { loaderData: { "0": { ok: true, session: false } } },
    });

    expect(
      await screen.findByRole("heading", { name: "KMLA Online" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("db-status")).toHaveTextContent(
      "Supabase 연결됨 · 세션 없음",
    );
  });

  it("surfaces a connection failure", async () => {
    renderRoute(Home, {
      hydrationData: {
        loaderData: { "0": { ok: false, error: "fetch failed" } },
      },
    });

    expect(await screen.findByTestId("db-status")).toHaveTextContent(
      "Supabase 연결 실패: fetch failed",
    );
  });
});
