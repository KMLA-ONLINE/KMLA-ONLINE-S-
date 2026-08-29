import { expect, test, type Page } from "@playwright/test";

async function loginAsAcceptedStudent(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill("student@kmla.hs.kr");
  await page.getByLabel("비밀번호", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("주요 메뉴는 뷰포트마다 정확히 하나만 노출된다", async ({ page }) => {
  await loginAsAcceptedStudent(page);
  // 사이드바(`max-md:hidden`)와 탭바(`md:hidden`) 둘 다 DOM에 있지만 `display:none`이
  // 접근성 트리에서 빼 주므로, 어느 폭에서든 내비게이션 랜드마크는 하나여야 한다.
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toHaveCount(
    1,
  );
});

test("focused 레이아웃에는 탭바가 없다", async ({ page }) => {
  await loginAsAcceptedStudent(page);
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
  await expect(page.getByText("404", { exact: true })).toBeVisible();
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
    orientation?: string;
  };
  expect(json.start_url).toBe("/");
  expect(json.display).toBe("standalone");
  expect(json.orientation).toBeUndefined();
  expect(json.icons.some((icon) => icon.sizes === "512x512")).toBeTruthy();
});

test("service worker imports a revalidated Push companion", async ({
  request,
}) => {
  const [serviceWorker, pushWorker] = await Promise.all([
    request.get("/sw.js"),
    request.get("/push-sw.js"),
  ]);

  expect(serviceWorker.ok()).toBeTruthy();
  expect(await serviceWorker.text()).toContain("/push-sw.js");
  expect(pushWorker.ok()).toBeTruthy();
  expect(pushWorker.headers()["cache-control"]).toMatch(/no-cache|max-age=0/);
});

test("첫 서비스 워커 설치는 현재 페이지를 새로고침하지 않는다", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const count = Number(sessionStorage.getItem("document-load-count") ?? "0");
    sessionStorage.setItem("document-load-count", String(count + 1));
  });
  await page.goto("/login");

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await expect(
    page.getByText("오프라인에서도 사용할 수 있습니다."),
  ).toBeVisible();

  expect(
    await page.evaluate(() => sessionStorage.getItem("document-load-count")),
  ).toBe("1");
});

test("정보를 모두 입력한 뒤 마지막 단계에서 OTP로 가입을 마친다", async ({
  page,
  request,
}, testInfo) => {
  const email = `e2e-${testInfo.project.name}-${Date.now()}@example.com`;

  await page.goto("/signup");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill("password123");
  await page.getByLabel("비밀번호 확인", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "다음" }).click();

  await page.getByLabel("이름").fill("가입 테스트");
  await page.getByLabel("사용자 유형").selectOption("teacher");
  await page.getByLabel("전화번호 (추천)").fill("010-1234-5678");

  // 코드는 이 버튼을 누르는 순간 발송된다. 메일함 폴링이 그 뒤에 오는 이유다.
  await page.getByRole("button", { name: "인증 코드 받기" }).click();
  await expect(page.getByLabel("인증 코드")).toBeVisible();

  let token = "";
  await expect
    .poll(
      async () => {
        const response = await request.get(
          "http://127.0.0.1:54624/api/v1/messages",
        );
        const body = (await response.json()) as {
          messages: {
            To: { Address: string }[];
            Snippet: string;
          }[];
        };
        const message = body.messages.find((item) =>
          item.To.some((recipient) => recipient.Address === email),
        );
        token = message?.Snippet.match(/\b\d{6}\b/)?.[0] ?? "";
        return token;
      },
      { timeout: 10_000 },
    )
    .not.toBe("");

  await page.getByLabel("인증 코드").fill(token);
  await page.getByRole("button", { name: "가입 신청 제출" }).click();
  await expect(page).toHaveURL(/\/pending$/);
  await expect(
    page.getByRole("heading", { name: "가입 신청을 확인하고 있어요" }),
  ).toBeVisible();
});
