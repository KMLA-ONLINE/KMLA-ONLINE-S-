import { expect, test } from "@playwright/test";

test("셸이 뜨고 index 라우트(피드)가 렌더된다", async ({ page }) => {
  await page.goto("/");

  // 셸 로더가 준 프로필을 페이지가 `useShellData()`로 읽는다.
  // (아직 `domains/shell/mock.ts`의 값이다 — 스키마가 들어오면 실제 프로필로 바뀐다.)
  await expect(page.getByText("홍길동님, 안녕하세요")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "동아리 박람회 안내" }),
  ).toBeVisible();
});

test("주요 메뉴는 뷰포트마다 정확히 하나만 노출된다", async ({ page }) => {
  // 사이드바(`max-md:hidden`)와 탭바(`md:hidden`) 둘 다 DOM에 있지만 `display:none`이
  // 접근성 트리에서 빼 주므로, 어느 폭에서든 내비게이션 랜드마크는 하나여야 한다.
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toHaveCount(
    1,
  );
});

test("focused 레이아웃에는 탭바가 없다", async ({ page }) => {
  // 레이아웃은 라우트 모듈의 플래그가 아니라 `routes.ts`상의 위치가 정한다.
  // `groups/create`는 `focused` 밑에 있으므로 탭바 없이 뒤로가기만 있어야 한다.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/groups/create");

  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "뒤로" })).toBeVisible();
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
