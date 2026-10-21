import { expect, test, type Page } from "@playwright/test";

// seed 대화(supabase/seed.sql): 홍길동과 김민준의 1:1 대화, 홍길동이 만든 그룹 대화.
const DIRECT = "c0000000-0000-0000-0000-000000000001";
const GROUP = "c0000000-0000-0000-0000-000000000002";

async function loginAsAcceptedStudent(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill("student@kmla.hs.kr");
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

test("채팅 목록 옆 좁은 대화 영역에서도 답장 인용은 버블 안에 들어간다", async ({
  page,
}) => {
  // 목록이 접히기 직전 폭이라 마우스 환경에서 메시지 버블이 가장 좁다.
  await page.setViewportSize({ width: 768, height: 900 });
  await loginAsAcceptedStudent(page);
  await page.goto(`/messenger/${DIRECT}`);

  const quotes = page.getByRole("button", { name: /원문 메시지 보기$/ });
  await expect(quotes.first()).toBeVisible();

  for (const quote of await quotes.all()) {
    const overflow = await quote.evaluate((element) => {
      const bubble = element.parentElement!.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return {
        left: bubble.left - box.left,
        right: box.right - bubble.right,
      };
    });
    expect(overflow.left).toBeLessThanOrEqual(0.5);
    expect(overflow.right).toBeLessThanOrEqual(0.5);
  }
});
