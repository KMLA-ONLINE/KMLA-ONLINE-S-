import { expect, test } from "@playwright/test";

const cases = [
  {
    name: "iPhone",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    maxTouchPoints: 5,
    content: "width=device-width, initial-scale=1, viewport-fit=cover",
  },
  {
    name: "iPadOS desktop UA",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    maxTouchPoints: 5,
    content: "width=device-width, initial-scale=1, viewport-fit=cover",
  },
  {
    name: "Android",
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 Chrome/135.0.0.0 Mobile Safari/537.36",
    maxTouchPoints: 5,
    content:
      "width=device-width, initial-scale=1, interactive-widget=resizes-content",
  },
  {
    name: "macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    maxTouchPoints: 0,
    content: "width=device-width, initial-scale=1",
  },
];

for (const platform of cases) {
  test.describe(platform.name, () => {
    test.use({ userAgent: platform.userAgent });

    test("sets one viewport before the application JavaScript loads", async ({
      page,
    }) => {
      await page.addInitScript((maxTouchPoints) => {
        Object.defineProperty(navigator, "maxTouchPoints", {
          value: maxTouchPoints,
        });
      }, platform.maxTouchPoints);
      await page.route("**/*", async (route) => {
        if (route.request().resourceType() === "script") {
          await route.abort();
        } else {
          await route.continue();
        }
      });

      await page.goto("/login");
      const viewport = page.locator('meta[name="viewport"]');
      await expect(viewport).toHaveCount(1);
      await expect(viewport).toHaveAttribute("content", platform.content);
    });

    test("viewport survives hydration and client navigation", async ({
      page,
    }) => {
      await page.addInitScript((maxTouchPoints) => {
        Object.defineProperty(navigator, "maxTouchPoints", {
          value: maxTouchPoints,
        });
      }, platform.maxTouchPoints);

      await page.goto("/login");
      await expect(
        page.getByRole("button", { name: "로그인", exact: true }),
      ).toBeVisible();
      const viewport = page.locator('meta[name="viewport"]');
      await expect(viewport).toHaveCount(1);
      await expect(viewport).toHaveAttribute("content", platform.content);

      await page.getByRole("link", { name: "회원가입" }).click();
      await expect(page).toHaveURL(/\/signup$/);
      await expect(viewport).toHaveCount(1);
      await expect(viewport).toHaveAttribute("content", platform.content);
    });
  });
}
