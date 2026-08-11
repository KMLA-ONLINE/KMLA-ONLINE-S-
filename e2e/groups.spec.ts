import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function loginAsAcceptedStudent(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill("student@kmla.hs.kr");
  await page.getByLabel("비밀번호", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("그룹 홈, 찾기, 공개 상세가 실제 데이터로 이어진다", async ({ page }) => {
  await loginAsAcceptedStudent(page);
  await page.goto("/groups");

  await expect(
    page.getByRole("heading", { name: "공식 그룹", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "학교 공지" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "29기 수학 탐구" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "지금 많이 찾는 그룹" }),
  ).toBeVisible();

  await page.goto("/groups/discover?q=메이커스");
  await expect(page.getByText("“메이커스” 검색 결과 1개")).toBeVisible();
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
  await page.setViewportSize({ width: 390, height: 780 });
  await loginAsAcceptedStudent(page);
  await page.goto("/groups/makers-lab");

  await expect(page.getByRole("button", { name: "뒤로" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "메이커스 랩", exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByText("그룹 소개")).toBeVisible();
});

test("가입 요청, 고정, 초대 전용 그룹 생성을 실제로 반영한다", async ({
  page,
}) => {
  await loginAsAcceptedStudent(page);

  await page.goto("/groups/film-circle");
  await page.getByRole("button", { name: "가입 요청" }).click();
  await expect(
    page.getByRole("button", { name: "가입 요청 취소" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "가입 요청 취소" }).click();
  await expect(page.getByRole("button", { name: "가입 요청" })).toBeVisible();

  await page.goto("/groups/g-8f2a1c4e6b9d7a3c5e10");
  await page.getByRole("button", { name: "고정 해제" }).click();
  await expect(
    page.getByRole("button", { name: "내 그룹에 고정" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "내 그룹에 고정" }).click();
  await expect(page.getByRole("button", { name: "고정 해제" })).toBeVisible();

  const groupName = `E2E 비공개 그룹 ${Date.now()}`;
  await page.goto("/groups/create");
  await page.getByLabel("그룹 이름").fill(groupName);
  await page.getByLabel("그룹 설명").fill("초대 전용 그룹 생성 검증");
  await page.getByRole("button", { name: "그룹 만들기" }).click();

  await expect(page).toHaveURL(/\/groups\/g-[a-f0-9]{20}$/);
  await expect(
    page.getByRole("heading", { name: groupName }).last(),
  ).toBeVisible();
  await expect(page.getByText("초대 전용 그룹 생성 검증")).toBeVisible();
});
