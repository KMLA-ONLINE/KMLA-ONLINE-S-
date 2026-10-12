import { expect, test, type Page } from "@playwright/test";

async function loginAsAcceptedStudent(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill("student@kmla.hs.kr");
  await page.getByLabel("비밀번호", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function confirmLogout(page: Page) {
  await page
    .getByRole("dialog", { name: "로그아웃하시겠습니까?" })
    .getByRole("button", { name: "로그아웃", exact: true })
    .click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "다시 만나서 반가워요" }),
  ).toBeVisible();
  await page.goto("/");
}

test("데스크톱 계정 메뉴에서 로그아웃하면 로그인 화면으로 이동한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAsAcceptedStudent(page);
  await page.getByRole("button", { name: "계정 메뉴" }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await confirmLogout(page);
  await expect(page).toHaveURL(/\/login$/);
});

test("모바일 설정에서 로그아웃하면 로그인 화면으로 이동한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await loginAsAcceptedStudent(page);
  await page.getByRole("link", { name: "학교생활", exact: true }).click();
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await confirmLogout(page);
  await expect(page).toHaveURL(/\/login$/);
});

test("주요 메뉴는 뷰포트마다 정확히 하나만 노출된다", async ({ page }) => {
  await loginAsAcceptedStudent(page);
  // 사이드바(`max-md:hidden`)와 탭바(`md:hidden`) 둘 다 DOM에 있지만 `display:none`이
  // 접근성 트리에서 빼 주므로, 어느 폭에서든 내비게이션 랜드마크는 하나여야 한다.
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toHaveCount(
    1,
  );
});

test("모바일 학교생활은 도구와 설정·프로필 진입을 분리한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await loginAsAcceptedStudent(page);
  await expect(
    page.getByRole("button", { name: "급식", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "학교생활 요약" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "학교생활", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "학교생활", exact: true }),
  ).toBeVisible();
  const tools = page.getByRole("navigation", { name: "학교생활 기능" });
  await expect(tools.getByRole("link")).toHaveCount(4);
  await expect(page.getByRole("link", { name: "도움말" })).toHaveCount(0);

  await tools.getByRole("link", { name: "공강 · 노래방", exact: true }).click();
  await expect(page).toHaveURL(/\/menu\/gongang$/);
  const modes = page.getByRole("navigation", { name: "공강 및 노래방" });
  await expect(
    modes.getByRole("link", { name: "공강", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await modes.getByRole("link", { name: "노래방", exact: true }).click();
  await expect(page).toHaveURL(/\/menu\/karaoke$/);
  await expect(
    modes.getByRole("link", { name: "노래방", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "뒤로" }).click();
  await expect(page).toHaveURL(/\/menu$/);

  const sites = page.getByRole("navigation", { name: "학교 사이트" });
  await expect(sites.getByRole("link")).toHaveCount(3);
  for (const name of ["민사고 홈페이지", "인트라넷", "리로스쿨"]) {
    const link = sites.getByRole("link", {
      name: `${name} (새 탭)`,
      exact: true,
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("target", "_blank");
  }

  await page.getByRole("link", { name: "설정", exact: true }).click();
  await expect(page).toHaveURL(/\/menu\/settings$/);
  await expect(page.getByRole("link", { name: "관리자 페이지" })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "도움말" }).click();
  await page.getByRole("button", { name: "뒤로" }).click();
  await expect(page).toHaveURL(/\/menu\/settings$/);
  await page.getByRole("button", { name: "뒤로" }).click();
  await expect(page).toHaveURL(/\/menu$/);
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await expect(page).toHaveURL(/\/profile\/[^/]+$/);
});

test("학교생활 메뉴는 모바일과 데스크톱에서 구역별로 정돈되고 가로로 넘치지 않는다", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await loginAsAcceptedStudent(page);
  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: "학교생활", exact: true })
    .click();
  await expect(page).toHaveURL(/\/menu$/);

  const tools = page.getByRole("navigation", { name: "학교생활 기능" });
  const sites = page.getByRole("navigation", { name: "학교 사이트" });
  for (const [width, toolRows, siteRows] of [
    [320, 2, 3],
    [390, 2, 3],
    [767, 2, 3],
    [768, 1, 1],
    [820, 1, 1],
    [1280, 1, 1],
    [1920, 1, 1],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await expect(tools.getByRole("link")).toHaveCount(4);
    await expect(sites.getByRole("link")).toHaveCount(3);
    await expect(
      page
        .getByRole("navigation", { name: "주요 메뉴" })
        .getByRole("link", { name: "학교생활", exact: true }),
    ).toHaveAttribute("aria-current", "page");

    for (const [nav, rows] of [
      [tools, toolRows],
      [sites, siteRows],
    ] as const) {
      const boxes = await nav.getByRole("link").evaluateAll((elements) =>
        elements.map((element) => {
          const { top, left, right } = element.getBoundingClientRect();
          return {
            top,
            left,
            right,
            fits: element.scrollWidth <= element.clientWidth,
          };
        }),
      );
      expect(new Set(boxes.map(({ top }) => top)).size).toBe(rows);
      expect(
        boxes.every(
          ({ left, right, fits }) => left >= 0 && right <= width && fits,
        ),
      ).toBe(true);
    }
    expect(
      await page
        .getByRole("main")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    const menuBox = await tools.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.width).toBeLessThanOrEqual(768);
  }

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await testInfo.attach(`school-life-${width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  }

  await tools.getByRole("link", { name: "급식", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/menu\/meal$/);
  await expect(
    page
      .getByRole("navigation", { name: "주요 메뉴" })
      .getByRole("link", { name: "학교생활", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("공강 관리의 새 주소도 일반 사용자의 접근 제한과 돌아가기 링크를 유지한다", async ({
  page,
}) => {
  await loginAsAcceptedStudent(page);
  await page.goto("/menu/gongang/manage");
  await expect(
    page.getByRole("heading", { name: "접근 권한이 없습니다" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "공강으로 돌아가기" }).click();
  await expect(page).toHaveURL(/\/menu\/gongang$/);
  await expect(
    page.getByRole("navigation", { name: "공강 및 노래방" }),
  ).toBeVisible();
});

test("이전 예약·바로가기 주소는 리다이렉트 없이 없는 페이지로 표시한다", async ({
  page,
}) => {
  for (const path of [
    "/util/gongang",
    "/util/gongang/manage",
    "/util/karaoke",
    "/menu/links",
  ]) {
    await page.goto(path);
    await expect(
      page.getByText("주소가 바뀌었거나, 페이지가 사라졌을 수 있어요."),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
});

test("태블릿 홈 바로가기는 생일·급식·시간표·공강·노래방·기부물품을 한 줄에 제공한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await loginAsAcceptedStudent(page);
  const shortcuts = page.getByRole("navigation", { name: "학교생활 바로가기" });
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts.getByRole("link")).toHaveCount(5);
  await expect(shortcuts.getByRole("separator")).toHaveCount(4);
  for (const separator of await shortcuts.getByRole("separator").all()) {
    await expect(separator).toHaveAttribute("aria-orientation", "vertical");
    await expect(separator).toBeVisible();
  }
  await expect(shortcuts.locator("a, button")).toHaveText([
    "생일",
    "급식",
    "시간표",
    "공강·노래방",
    "기부물품",
  ]);
  await expect(
    shortcuts.getByRole("link", { name: "기부물품" }),
  ).toHaveAttribute("href", "#");
  await shortcuts.getByRole("link", { name: "기부물품" }).click();
  await expect(page).toHaveURL(/\/#$/);
  await expect(
    page.getByRole("banner").getByRole("link", { name: "공강·노래방" }),
  ).toHaveCount(0);
  for (const [name, path] of [
    ["급식", "/menu/meal"],
    ["생일", "/menu/birthdays"],
    ["시간표", "/menu/timetable"],
    ["공강·노래방", "/menu/gongang"],
  ]) {
    await shortcuts.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page.goto("/");
  }
  for (const width of [768, 820, 1023]) {
    await page.setViewportSize({ width, height: 1180 });
    await expect(shortcuts).toBeVisible();
    const boxes = await shortcuts.locator("a, button").evaluateAll((elements) =>
      elements.map((element) => {
        const { top, left, right } = element.getBoundingClientRect();
        return {
          top,
          left,
          right,
          fits: element.scrollWidth <= element.clientWidth,
        };
      }),
    );
    expect(new Set(boxes.map(({ top }) => top)).size).toBe(1);
    const widths = boxes.map(({ left, right }) => right - left);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    expect(
      boxes.every(
        ({ left, right, fits }) => left >= 0 && right <= width && fits,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1024, height: 1180 });
  await expect(shortcuts).toBeHidden();
  await expect(
    page.getByRole("complementary", { name: "학교생활 요약" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(shortcuts).toBeHidden();
  await expect(page.getByRole("link", { name: "기부물품" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "학교생활", exact: true }),
  ).toBeVisible();
});

test("데스크톱 홈 사이드바는 생일·급식·오늘 시간표를 제공한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAsAcceptedStudent(page);
  const sidebar = page.getByRole("complementary", { name: "학교생활 요약" });
  await expect(sidebar).toBeVisible();
  const shortcuts = sidebar.getByRole("navigation", {
    name: "예약·기부 바로가기",
  });
  await expect(shortcuts.getByRole("separator")).toHaveCount(1);
  await expect(shortcuts.getByRole("separator")).toHaveAttribute(
    "aria-orientation",
    "vertical",
  );
  await expect(shortcuts.getByRole("separator")).toBeVisible();
  await expect(
    shortcuts.getByRole("link", { name: "공강·노래방" }),
  ).toHaveAttribute("href", "/menu/gongang");
  await expect(
    shortcuts.getByRole("link", { name: "기부물품" }),
  ).toHaveAttribute("href", "#");
  await shortcuts.getByRole("link", { name: "기부물품" }).click();
  await expect(page).toHaveURL(/\/#$/);
  await expect(shortcuts.locator("a, button")).toHaveText([
    "공강·노래방",
    "기부물품",
  ]);
  await expect(
    page.getByRole("banner").getByRole("link", { name: "공강·노래방" }),
  ).toHaveCount(0);
  for (const width of [1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const reservationBox = await shortcuts
      .getByRole("link", { name: "공강·노래방" })
      .boundingBox();
    const donationBox = await shortcuts
      .getByRole("link", { name: "기부물품" })
      .boundingBox();
    const birthdayBox = await sidebar
      .getByRole("link", { name: "생일 보기" })
      .boundingBox();
    expect(reservationBox).not.toBeNull();
    expect(donationBox).not.toBeNull();
    expect(birthdayBox).not.toBeNull();
    expect(reservationBox!.y).toBe(donationBox!.y);
    expect(reservationBox!.x + reservationBox!.width).toBeLessThan(
      donationBox!.x,
    );
    expect(reservationBox!.y + reservationBox!.height).toBeLessThan(
      birthdayBox!.y,
    );
  }
  await expect(
    sidebar.getByRole("heading", { name: /오늘의|내일의/ }),
  ).toHaveCount(0);
  await expect(sidebar.getByText("전체 보기", { exact: true })).toHaveCount(0);
  await expect(
    sidebar.getByRole("link", { name: "생일 보기" }),
  ).toHaveAttribute("href", "/menu/birthdays");
  await expect(
    sidebar.getByRole("link", { name: "급식 보기" }),
  ).toHaveAttribute("href", "/menu/meal");
  await expect(
    sidebar.getByRole("link", { name: "시간표 보기" }),
  ).toHaveAttribute("href", "/menu/timetable");
  const timetable = sidebar.getByRole("link", { name: "시간표 보기" });
  await expect(sidebar).toHaveCSS("row-gap", "12px");
  await expect(timetable).not.toHaveCSS("border-radius", "0px");
  const radius = await timetable.evaluate(
    (element) => getComputedStyle(element).borderRadius,
  );
  for (const name of ["생일 보기", "급식 보기", "시간표 보기"]) {
    const content = sidebar.getByRole("link", { name, exact: true });
    await expect(content).toHaveCSS("border-radius", radius);
    await expect(content).toHaveCSS("padding-top", "8px");
    await expect(content).toHaveCSS("padding-bottom", "8px");
    await expect(content).toHaveCSS("padding-left", "8px");
    await expect(content).toHaveCSS("padding-right", "8px");
  }
  await expect(
    sidebar.getByRole("heading", { name: "생일", exact: true }),
  ).toBeVisible();
  const background = await timetable.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await timetable.hover();
  await expect(timetable).not.toHaveCSS("background-color", background);
  for (const [name, path] of [
    ["생일 보기", "/menu/birthdays"],
    ["급식 보기", "/menu/meal"],
    ["시간표 보기", "/menu/timetable"],
  ]) {
    await sidebar.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page.goto("/");
  }
  await expect(
    page.getByRole("link", { name: "학교생활", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "공강·노래방", exact: true }),
  ).toHaveAttribute("href", "/menu/gongang");
  await page.goto("/menu");
  await expect(page).toHaveURL(/\/menu$/);
  await expect(
    page.getByRole("navigation", { name: "학교생활 기능" }),
  ).toBeVisible();
});

test("데스크톱 아바타 메뉴에서 설정과 확인 후 로그아웃을 연다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAsAcceptedStudent(page);
  const avatar = page.getByRole("button", { name: "계정 메뉴" });
  await avatar.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitem", { name: "내 프로필" }),
  ).toHaveAttribute("href", "/profile");
  await expect(page.getByRole("menuitem")).toHaveCount(6);
  await expect(
    page.getByRole("menuitem", { name: /민사고 홈페이지/ }),
  ).toHaveAttribute("href", "https://www.minjok.hs.kr/");
  await expect(
    page.getByRole("menuitem", { name: /인트라넷/ }),
  ).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("menuitem", { name: /리로스쿨/ }),
  ).toHaveAttribute("rel", "noreferrer");
  await page.getByRole("menuitem", { name: "설정", exact: true }).click();
  await expect(page).toHaveURL(/\/menu\/settings$/);

  await avatar.click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  const dialog = page.getByRole("dialog", { name: "로그아웃하시겠습니까?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();
  await expect(avatar).toBeFocused();
  await expect(page).toHaveURL(/\/menu\/settings$/);

  await avatar.click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await dialog.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
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

test("첫 화면은 스타일시트를 네트워크로 받지 않는다", async ({ page }) => {
  // `scripts/inline-root-css.mjs`가 유일한 render-blocking 스타일시트를 index.html에
  // 인라인하고, 라우트 매니페스트의 `css` 목록에서도 뺀다. 매니페스트 쪽을 놓치면
  // 하이드레이션한 `<Links />`가 이미 인라인된 CSS를 한 번 더 받아 온다 — 화면은 멀쩡해서
  // 요청 수를 보지 않으면 드러나지 않는다.
  const stylesheets: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "stylesheet") {
      stylesheets.push(request.url());
    }
  });

  await page.goto("/login");
  // 하이드레이션이 끝난 뒤를 봐야 한다. `<Links />`가 링크를 다시 그리는 것은 그때다.
  await expect(page.getByRole("button", { name: "로그인" })).toBeVisible();

  expect(stylesheets).toEqual([]);
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
