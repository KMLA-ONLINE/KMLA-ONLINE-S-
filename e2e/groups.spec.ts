import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function loginAsAcceptedStudent(page: Page) {
  // 모바일 뷰포트에서는 PWA 설치 안내가 모달로 떠서 다른 다이얼로그를 가린다. 미리 꺼 둔다.
  await page.addInitScript(() => {
    localStorage.setItem(
      "kmla-online:pwa-install-preference",
      JSON.stringify({ dismissCount: 0, installed: false, neverShow: true }),
    );
  });
  await page.goto("/login");
  await page.getByLabel("이메일").fill("student@kmla.hs.kr");
  await page.getByLabel("비밀번호", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("그룹 홈, 찾기, 공개 상세가 실제 데이터로 이어진다", async ({ page }) => {
  // 이 테스트는 데스크톱 레이아웃을 검증한다. 모바일 프로젝트에서도 도니 뷰포트를 직접 잡는다
  // (모바일 동선은 아래 별도 테스트가 본다).
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsAcceptedStudent(page);
  await page.goto("/groups");

  const appContent = page.locator('[data-slot="app-content"]');
  await expect(appContent).toHaveAttribute("data-content-width", "4xl");
  expect((await appContent.boundingBox())?.width).toBeGreaterThanOrEqual(800);

  await expect(
    page.getByRole("button", { name: "공식", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "학교 공지" })).toBeVisible();
  await page.getByRole("link", { name: "학교 공지" }).click();
  await expect(page.getByRole("img", { name: "공식 그룹" })).toBeVisible();
  await page.goto("/groups?tab=unofficial");
  await page.getByRole("button", { name: "비공식", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "29기 수학 탐구" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "비공식 그룹 찾아보기" }),
  ).toBeVisible();

  await page.goto("/groups/discover");
  await expect(page.getByRole("link", { name: "메이커스 랩" })).toBeVisible();
  await expect(page.getByText(/공개 그룹 \d+개/)).toHaveCount(0);
  await page.getByRole("button", { name: "그룹 검색" }).click();
  await page.getByLabel("그룹 이름").fill("메");
  await expect(
    page.getByRole("button", { name: "그룹 검색", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "그룹 검색", exact: true }).click();
  await expect(page).toHaveURL(/\/groups\/discover\?q=%EB%A9%94/);
  await page.getByRole("link", { name: "메이커스 랩" }).click();

  await expect(page).toHaveURL(/\/groups\/makers-lab$/);
  await expect(
    page.getByRole("heading", { name: "메이커스 랩", exact: true }).last(),
  ).toBeVisible();
  await expect(
    page.getByText("개발, 로보틱스, 제작 프로젝트를 함께 진행합니다."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "그룹 가입" })).toBeVisible();
});

test("모바일에서도 그룹 핵심 동선과 뒤로가기를 제공한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await loginAsAcceptedStudent(page);
  await page.goto("/groups?tab=unofficial");
  await expect(page.getByRole("link", { name: "메이커스 랩" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "비공식 그룹 찾아보기" }),
  ).toHaveAttribute("href", "/groups/discover");
  const myGroupRow = page
    .locator('[data-slot="group-summary-row"]')
    .filter({ has: page.getByRole("link", { name: "29기 수학 탐구" }) });
  await expect(myGroupRow.getByRole("button", { name: /고정/ })).toHaveClass(
    /sr-only/,
  );
  // 시드에서 이 그룹은 고정 상태라 문단 텍스트가 "고정됨 멤버 N명"이다. 모바일 전용 문단이
  // DOM 상 먼저 오므로 first()가 그것을 가리킨다.
  await expect(
    myGroupRow.locator("p", { hasText: /멤버 \d+명/ }).first(),
  ).toBeVisible();
  await myGroupRow.evaluate((element) => {
    const pointerEvent = {
      bubbles: true,
      pointerType: "touch",
      clientX: 40,
      clientY: 40,
    };
    element.dispatchEvent(new PointerEvent("pointerdown", pointerEvent));
    window.setTimeout(() => {
      element.dispatchEvent(new PointerEvent("pointerup", pointerEvent));
    }, 600);
  });
  await expect(page.getByRole("dialog")).toContainText("29기 수학 탐구");
  await page.getByRole("button", { name: "취소" }).click();
  await page.goto("/groups/discover?q=메이");
  await expect(
    page.locator('[data-slot="group-mobile-discover-card"]'),
  ).toHaveCount(1);
  await expect(
    page
      .locator('[data-slot="group-mobile-discover-card"]')
      .getByText(/즉시 가입/),
  ).toBeVisible();
  await page.goto("/groups/makers-lab");

  await expect(
    page.getByRole("button", { name: "그룹 목록으로 돌아가기" }),
  ).toBeVisible();
  const mobileHeader = page.locator('[data-slot="group-detail-mobile-header"]');
  await page.getByRole("main").evaluate((element) => element.scrollTo(0, 200));
  await expect(mobileHeader).toBeInViewport();
  await page.getByRole("main").evaluate((element) => element.scrollTo(0, 0));
  await expect(mobileHeader).toBeInViewport();
  await expect(
    page.getByRole("heading", { name: "메이커스 랩", exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "그룹 정보" })).toBeHidden();
});

test("가입 요청, 고정, 초대 전용 그룹 생성을 실제로 반영한다", async ({
  page,
}) => {
  await loginAsAcceptedStudent(page);

  await page.goto("/groups/film-circle");
  // 승인제 그룹은 확인 다이얼로그를 한 번 거친다.
  await page.getByRole("button", { name: "가입 요청" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "가입 요청" })
    .click();
  await expect(
    page.getByRole("button", { name: "가입 요청 취소" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "가입 요청 취소" }).click();
  await expect(page.getByRole("button", { name: "가입 요청" })).toBeVisible();

  await page.goto("/groups/8f2a1c4e6b9d7a");
  await page.getByRole("button", { name: "그룹 옵션" }).click();
  await page.getByRole("menuitem", { name: "고정 해제" }).click();
  await page.getByRole("button", { name: "그룹 옵션" }).click();
  await expect(
    page.getByRole("menuitem", { name: "내 그룹에 고정" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "내 그룹에 고정" }).click();
  await page.getByRole("button", { name: "그룹 옵션" }).click();
  await expect(page.getByRole("menuitem", { name: "고정 해제" })).toBeVisible();

  const groupName = `E2E 비공개 그룹 ${Date.now()}`;
  await page.goto("/groups/create");
  await expect(page.locator('[data-slot="app-content"]')).toHaveAttribute(
    "data-content-width",
    "2xl",
  );
  await page.getByLabel("그룹 이름").fill(groupName);
  await page.getByLabel("그룹 설명").fill("초대 전용 그룹 생성 검증");
  await page.getByRole("button", { name: "그룹 만들기" }).click();
  // 생성도 확인 다이얼로그를 한 번 거친다.
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "만들기", exact: true })
    .click();

  await expect(page).toHaveURL(/\/groups\/[a-f0-9]{14}$/);
  await expect(
    page.getByRole("heading", { name: groupName }).last(),
  ).toBeVisible();
  // 그룹 설명은 모바일 상세에서 숨는다. 저장됐는지만 본다.
  await expect(page.getByText("초대 전용 그룹 생성 검증")).toBeAttached();
});
