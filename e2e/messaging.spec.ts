import { expect, test, type Page } from "@playwright/test";

// seed 대화(supabase/seed.sql): 홍길동과 김민준의 1:1 대화, 홍길동이 만든 그룹 대화.
const DIRECT = "c0000000-0000-0000-0000-000000000001";
const GROUP = "c0000000-0000-0000-0000-000000000002";

async function loginAsAcceptedStudent(
  page: Page,
  email = "student@kmla.hs.kr",
) {
  const later = page.getByRole("button", { name: "나중에", exact: true });
  await page.addLocatorHandler(later, () => later.click());
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("좁은 화면에서 연 상세 패널은 화면을 넓히면 대화 옆에 배치된다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await loginAsAcceptedStudent(page);
  await page.goto(`/messenger/${DIRECT}`);

  await page.getByRole("button", { name: "채팅 정보 열기" }).click();
  const conversation = page.getByRole("region", { name: "김민준 채팅" });
  const details = page.getByRole("complementary", { name: "채팅 상세" });
  await expect(details).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(conversation).toBeVisible();
  await expect(details).toBeVisible();

  const conversationBox = await conversation.boundingBox();
  const detailsBox = await details.boundingBox();
  expect(conversationBox).not.toBeNull();
  expect(detailsBox).not.toBeNull();
  expect(conversationBox!.x + conversationBox!.width).toBeLessThanOrEqual(
    detailsBox!.x + 1,
  );
});

test("채팅 별명은 다른 멤버에게 실시간으로 보이고 원래 이름으로 되돌릴 수 있다", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const alias = "민준 별명 테스트";
  const otherContext = await browser.newContext({
    baseURL,
    viewport: page.viewportSize(),
  });
  const other = await otherContext.newPage();

  async function openDetails(target: Page) {
    await target.getByRole("button", { name: /채팅 정보 보기$/ }).click();
  }
  async function editNickname(value: string) {
    await page.getByRole("button", { name: "별명", exact: true }).click();
    await page.getByRole("button", { name: "김민준 별명 변경" }).click();
    await page.getByRole("textbox", { name: "별명", exact: true }).fill(value);
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "별명 변경" })).toBeHidden();
  }

  try {
    await loginAsAcceptedStudent(page);
    await page.goto(`/messenger/${GROUP}`);
    await openDetails(page);
    await editNickname("");
    await loginAsAcceptedStudent(other, "student2@kmla.hs.kr");
    await other.goto(`/messenger/${GROUP}`);
    await openDetails(other);
    await other.getByText(/^채팅 멤버 \d+명$/).click();

    await editNickname(alias);
    await expect(
      other
        .getByRole("complementary", { name: "채팅 상세" })
        .getByText(`${alias} (나)`, { exact: true }),
    ).toBeVisible();
    await editNickname("");
    await expect(
      other
        .getByRole("complementary", { name: "채팅 상세" })
        .getByText("김민준 (나)", { exact: true }),
    ).toBeVisible();

    await page.goto(`/messenger/${DIRECT}`);
    await openDetails(page);
    await editNickname(alias);
    await expect(
      page
        .getByRole("complementary", { name: "채팅 상세" })
        .getByRole("heading", { name: alias, exact: true }),
    ).toBeVisible();
    await editNickname("");
    await expect(
      page
        .getByRole("complementary", { name: "채팅 상세" })
        .getByRole("heading", { name: "김민준", exact: true }),
    ).toBeVisible();
  } finally {
    await otherContext.close().catch(() => undefined);
  }
});

test("접은 대화 상세 패널은 다른 대화로 이동해도 닫힌 상태를 유지한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsAcceptedStudent(page);
  await page.goto(`/messenger/${DIRECT}`);

  await page.getByRole("button", { name: "채팅 정보 닫기" }).click();
  await expect(
    page.getByRole("button", { name: "채팅 정보 열기" }),
  ).toBeVisible();

  await page.getByRole("link", { name: /학생회 기획부/ }).click();
  await expect(page).toHaveURL(new RegExp(`/messenger/${GROUP}$`));
  await expect(
    page.getByRole("button", { name: "채팅 정보 열기" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "채팅 상세" }),
  ).toBeHidden();
});
