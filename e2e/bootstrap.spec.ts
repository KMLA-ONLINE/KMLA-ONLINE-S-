import { expect, test, type Page } from "@playwright/test";

async function loginAsAcceptedStudent(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill("student@kmla.hs.kr");
  await page.getByLabel("비밀번호", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(
    page.getByRole("navigation", { name: "주요 메뉴" }),
  ).toBeVisible();
}

test("초기 요청 재시도가 숨김 상태에서 멈춰도 탭 복귀 시 앱을 표시한다", async ({
  page,
}) => {
  await loginAsAcceptedStudent(page);

  // 새 문서에는 조회 캐시가 없다. 브라우저의 탭 숨김/복귀를 결정적으로 모사한다.
  await page.addInitScript(() => {
    let visibility = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    window.addEventListener("test:show-tab", () => {
      visibility = "visible";
      window.dispatchEvent(new Event("visibilitychange"));
    });
  });

  let attempts = 0;
  await page.route("**/rest/v1/rpc/list_active_stories", async (route) => {
    attempts += 1;
    await route.fulfill({
      status: attempts === 1 ? 503 : 200,
      contentType: "application/json",
      body: attempts === 1 ? '{"message":"temporary failure"}' : "[]",
    });
  });
  await page.clock.install();
  await page.goto("/");
  await expect.poll(() => attempts).toBe(1);
  // 초기 재시도 지연(1초)을 넘겨, 숨김 상태에서 재시도가 멈추는 조건을 만든다.
  await page.clock.fastForward(2_000);
  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toHaveCount(
    0,
  );

  await page.evaluate(() => window.dispatchEvent(new Event("test:show-tab")));
  await expect(
    page.getByRole("navigation", { name: "주요 메뉴" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "스토리 만들기" }),
  ).toBeVisible();
});

test("초기 요청 재시도가 오프라인에서 멈춰도 온라인 복귀 시 앱을 표시한다", async ({
  page,
}) => {
  await loginAsAcceptedStudent(page);

  let attempts = 0;
  await page.route("**/rest/v1/rpc/list_active_stories", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      // JS 청크까지 차단하지 않고, 요청 실패 시 연결이 끊기는 상황만 모사한다.
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    }
    await route.fulfill({
      status: attempts === 1 ? 503 : 200,
      contentType: "application/json",
      body: attempts === 1 ? '{"message":"temporary failure"}' : "[]",
    });
  });
  await page.clock.install();
  await page.goto("/");
  await expect.poll(() => attempts).toBe(1);
  await page.clock.fastForward(2_000);
  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toHaveCount(
    0,
  );

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.getByRole("navigation", { name: "주요 메뉴" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "스토리 만들기" }),
  ).toBeVisible();
});
