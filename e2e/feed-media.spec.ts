import { expect, test } from "@playwright/test";

test("피드 본문은 미디어 서명을 기다리지 않고 이미지 공간을 유지한다", async ({
  page,
}) => {
  let release!: () => void;
  const signing = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rest/v1/rpc/list_feed_posts", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    rows[0] = {
      ...rows[0],
      body: "서명 대기 중에도 보이는 피드 본문",
      activity_kind: null,
      activity_media_path: null,
      attachments: [
        {
          attachment_id: "delayed-photo",
          object_path: "fixture/delayed-photo.webp",
          original_filename: "delayed.webp",
          storage_bucket: "post-attachments",
          mime_type: "image/webp",
          position: 0,
          size_bytes: 100,
          width: 900,
          height: 1200,
          thumbnail_path: null,
        },
      ],
    };
    await route.fulfill({ response, json: rows });
  });
  await page.route(
    "**/storage/v1/object/sign/post-attachments",
    async (route) => {
      await signing;
      const { paths } = route.request().postDataJSON() as { paths: string[] };
      await route.fulfill({
        json: paths.map((path) => ({
          path,
          signedURL: `/object/sign/post-attachments/${path}?token=fixture`,
          error: null,
        })),
      });
    },
  );

  try {
    await page.goto("/login");
    await page.getByLabel("이메일").fill("student@kmla.hs.kr");
    await page.getByLabel("비밀번호", { exact: true }).fill("password123");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(
      page.getByText("서명 대기 중에도 보이는 피드 본문"),
    ).toBeVisible();
    const tile = page.getByRole("button", { name: "delayed.webp 크게 보기" });
    await expect(tile).toBeDisabled();
    await expect(tile.getByText("이미지 불러오는 중")).toBeVisible();
    const before = await tile.boundingBox();
    expect(before).not.toBeNull();

    release();
    await expect(tile).toBeEnabled();
    const after = await tile.boundingBox();
    expect(after?.height).toBeCloseTo(before!.height, 0);
    expect(after?.width).toBeCloseTo(before!.width, 0);
  } finally {
    release();
  }
});
