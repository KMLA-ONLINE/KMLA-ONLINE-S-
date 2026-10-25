import { expect, test, type Locator, type Page } from "@playwright/test";

test.setTimeout(60_000);

/** Measure rendered colors, including translucent text and the surface behind it. */
async function contrast(locator: Locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 1, 1);
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      ancestors.unshift(node);
    }
    for (const node of ancestors) {
      context.fillStyle = getComputedStyle(node).backgroundColor;
      context.fillRect(0, 0, 1, 1);
    }
    const background = context.getImageData(0, 0, 1, 1).data.slice(0, 3);
    context.fillStyle = getComputedStyle(element).color;
    context.fillRect(0, 0, 1, 1);
    const foreground = context.getImageData(0, 0, 1, 1).data.slice(0, 3);
    const luminance = (color: Uint8ClampedArray) => {
      const channels = Array.from(color, (channel) => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const first = luminance(background);
    const second = luminance(foreground);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  });
}

async function login(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("이메일").fill("student@kmla.hs.kr");
  await page.getByLabel("비밀번호", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  // 개발 서버나 느린 WebKit에서는 로그인 왕복이 기본 5초를 넘기기도 한다.
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Set the initial preference once; subsequent navigations must retain UI changes.
    if (localStorage.getItem("theme") === null) {
      localStorage.setItem("theme", "dark");
    }
    localStorage.setItem("kmla-online:experimental-features:v1", "true");
    localStorage.setItem(
      "kmla-online:pwa-install-preference",
      JSON.stringify({ installed: false, neverShow: true, dismissals: 0 }),
    );
  });
  const later = page.getByRole("button", {
    name: "나중에",
    exact: true,
    disabled: false,
  });
  await page.addLocatorHandler(later, () => later.click());
});

test("다크 로그인은 버튼·본문·설명·링크가 읽기 쉽다", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const heading = page.getByRole("heading", { name: "다시 만나서 반가워요" });
  await expect(heading).toBeVisible();
  for (const target of [
    heading,
    page.getByText("로그인해 소식과 이야기를 이어가세요.", { exact: true }),
    page.getByRole("button", { name: "로그인", exact: true }),
    page.getByRole("link", { name: "회원가입", exact: true }),
    page.getByLabel("이메일"),
  ]) {
    expect(await contrast(target)).toBeGreaterThanOrEqual(4.5);
  }
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
});

test("테마 변경과 새로고침 후 브라우저 표시색이 화면 배경과 일치한다", async ({
  page,
}) => {
  await login(page);
  await page.goto("/settings/lab", { waitUntil: "domcontentloaded" });
  for (const name of ["라이트", "다크"]) {
    const option = page.getByRole("button", { name, exact: true });
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(option).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const color = document
            .querySelector('meta[name="theme-color"]')
            ?.getAttribute("content");
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d")!;
          const sample = (value: string) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = value;
            context.fillRect(0, 0, 1, 1);
            return Array.from(context.getImageData(0, 0, 1, 1).data).join(",");
          };
          return (
            sample(color ?? "transparent") ===
            sample(getComputedStyle(document.body).backgroundColor)
          );
        }),
      )
      .toBe(true);
  }
  await expect(
    page.getByRole("button", { name: "다크", exact: true }),
  ).toBeVisible();
});

test("다크 피드·대화·설정은 좁은 화면에서도 잘리지 않고 메시지가 선명하다", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.screenshot({ path: testInfo.outputPath("dark-feed.png") });
  await page.goto("/messenger/c0000000-0000-0000-0000-000000000001", {
    waitUntil: "domcontentloaded",
  });
  const ownMessage = page.getByRole("article", {
    name: "내 메시지",
    exact: true,
  });
  await expect(ownMessage.first()).toBeVisible();
  const bubble = ownMessage.locator("[data-slot=message-bubble-text]").first();
  await expect(bubble).toBeVisible();
  expect(await contrast(bubble)).toBeGreaterThanOrEqual(4.5);
  const received = page
    .getByRole("region", { name: "김민준 채팅", exact: true })
    .getByText("나 5분 늦을 것 같아 🙏", { exact: true });
  await expect(received).toBeVisible();
  expect(await contrast(received)).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: testInfo.outputPath("dark-conversation.png") });
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("switch", { name: "실험실 기능 사용" }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await page.screenshot({ path: testInfo.outputPath("dark-settings.png") });
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "로그아웃하시겠습니까?",
  });
  await expect(confirmation).toBeVisible();
  expect(
    await contrast(confirmation.getByRole("heading")),
  ).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: testInfo.outputPath("dark-confirmation.png") });
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
});
