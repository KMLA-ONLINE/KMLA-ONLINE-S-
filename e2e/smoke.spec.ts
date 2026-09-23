import { expect, test } from "@playwright/test";

test("home renders and reaches Supabase", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "KMLA Online" }),
  ).toBeVisible();
  await expect(page.getByTestId("db-status")).toContainText("Supabase 연결됨");
});

test("client-side navigation falls back to index.html on deep links", async ({
  page,
}) => {
  // SPA mode serves a single index.html for every path; a hard load of an
  // unknown URL must still boot the app and render the 404 boundary rather
  // than returning a server 404.
  const response = await page.goto("/definitely-not-a-route");

  expect(response?.status()).toBe(200);
  await expect(page.getByText("404")).toBeVisible();
});

test("PWA manifest is served and installable", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );

  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();

  const json = (await manifest.json()) as {
    start_url: string;
    display: string;
    icons: { sizes: string }[];
  };
  expect(json.start_url).toBe("/");
  expect(json.display).toBe("standalone");
  expect(json.icons.some((icon) => icon.sizes === "512x512")).toBeTruthy();
});
