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

interface RetrySleep {
  scheduled: number;
  fired: number;
}

// 초기 재시도 지연(1초) 타이머의 예약·만료를 센다. 가짜 setTimeout을 감싸야 하므로
// page.clock.install() 뒤에 등록한다.
async function trackRetrySleep(page: Page) {
  await page.addInitScript(() => {
    const state: RetrySleep = { scheduled: 0, fired: 0 };
    Object.assign(window, { __retrySleep: state });
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number) => {
      if (timeout !== 1_000 || typeof handler !== "function") {
        return original(handler, timeout);
      }
      state.scheduled += 1;
      const callback = handler as () => void;
      return original(() => {
        state.fired += 1;
        callback();
      }, timeout);
    }) as typeof window.setTimeout;
  });
}

function retrySleep(page: Page, key: keyof RetrySleep) {
  return page.evaluate(
    (k) => (window as unknown as { __retrySleep: RetrySleep }).__retrySleep[k],
    key,
  );
}

function mockStoriesFailingOnce(page: Page) {
  let attempts = 0;
  return {
    attempts: () => attempts,
    install: () =>
      page.route("**/rest/v1/rpc/list_active_stories", async (route) => {
        attempts += 1;
        await route.fulfill({
          status: attempts === 1 ? 503 : 200,
          contentType: "application/json",
          body: attempts === 1 ? '{"message":"temporary failure"}' : "[]",
        });
      }),
  };
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

  const stories = mockStoriesFailingOnce(page);
  await stories.install();
  await page.clock.install();
  await trackRetrySleep(page);
  await page.goto("/");
  // 503 처리 후 재시도 대기가 예약된 다음에야 시계를 앞당길 수 있다.
  await expect.poll(() => retrySleep(page, "scheduled")).toBeGreaterThan(0);
  await page.clock.fastForward(2_000);
  // 대기가 끝났는데도 다시 요청하지 않으면 숨김 상태에서 재시도가 멈춘 것이다.
  await expect.poll(() => retrySleep(page, "fired")).toBeGreaterThan(0);
  expect(stories.attempts()).toBe(1);
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

  const stories = mockStoriesFailingOnce(page);
  await stories.install();
  await page.clock.install();
  await trackRetrySleep(page);
  await page.goto("/");
  await expect.poll(() => retrySleep(page, "scheduled")).toBeGreaterThan(0);
  // 시계가 멈춰 있으므로 대기가 끝나기 전에 연결 끊김을 알린다. JS 청크까지 차단하지
  // 않고 요청 실패 시 연결이 끊기는 상황만 모사한다.
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.clock.fastForward(2_000);
  await expect.poll(() => retrySleep(page, "fired")).toBeGreaterThan(0);
  expect(stories.attempts()).toBe(1);
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
