import { expect, test, type Page } from "@playwright/test";

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
  await page.goto("/messenger/hyunwoo");

  await page.getByRole("button", { name: "대화 정보 열기" }).click();
  const conversation = page.getByRole("region", { name: "이현우 대화" });
  const details = page.getByRole("complementary", { name: "대화 상세" });
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
