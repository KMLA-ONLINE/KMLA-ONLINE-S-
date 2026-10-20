import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 360, height: 800 } });

for (const isAuthor of [true, false]) {
  for (const kind of ["avatar_changed", "cover_changed"] as const) {
    test(`${isAuthor ? "본인" : "다른 사람"} 프로필 활동 ${kind}: 기존 헤더 높이와 아이콘 위치를 유지한다`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem(
          "kmla-online:pwa-install-preference",
          JSON.stringify({
            dismissCount: 0,
            installed: false,
            neverShow: true,
          }),
        );
      });
      await page.route("**/rest/v1/rpc/list_feed_posts", async (route) => {
        await route.fulfill({
          json: [
            {
              post_id: "11111111-1111-4111-8111-111111111111",
              body: "",
              published_at: "2026-10-20T12:00:00Z",
              edited_at: null,
              author_avatar_path: null,
              category_name: null,
              mentions: [],
              my_reaction: null,
              top_reactions: [],
              reaction_count: 0,
              comment_count: 0,
              feed_epoch: "2026-10-20T12:00:00Z",
              next_page_token: null,
              feed_position: 1,
              rank_time: "2026-10-20T12:00:00Z",
              kind: "profile",
              title: null,
              group_id: null,
              group_name: null,
              group_slug: null,
              author_name: "김가나다라",
              author_label: "김가나다라",
              author_identity: "identified",
              author_pub_id: "layout-test",
              timeline_name: "김가나다라",
              timeline_pub_id: "layout-test",
              visibility: "public",
              activity_kind: kind,
              activity_media_path: null,
              attachments: [],
              is_author: isAuthor,
              is_pinned: false,
            },
          ],
        });
      });
      await page.goto("/login");
      await page.getByLabel("이메일").fill("student@kmla.hs.kr");
      await page.getByLabel("비밀번호", { exact: true }).fill("password123");
      await page.getByRole("button", { name: "로그인", exact: true }).click();

      const header = page.locator("article > header");
      await expect(header.getByText("김가나다라", { exact: true })).toBeVisible(
        {
          timeout: 20_000,
        },
      );
      await expect(
        page.getByRole("button", { name: "24시간 가리기" }),
      ).toHaveCount(isAuthor ? 0 : 1);
      await expect(
        page.getByRole("button", { name: "게시물 옵션" }),
      ).toHaveCount(isAuthor ? 1 : 0);
      for (const width of [360, 393]) {
        await page.setViewportSize({ width, height: 800 });
        const headerBox = (await header.boundingBox())!;
        expect(headerBox.height).toBe(64);
        const control = (await page
          .getByRole("button", {
            name: isAuthor ? "게시물 옵션" : "24시간 가리기",
          })
          .boundingBox())!;
        expect(control.y - headerBox.y).toBe(12);
        expect(control.width).toBe(32);
        expect(control.height).toBe(32);
        const nameLayout = await header
          .getByRole("link", { name: "김가나다라", exact: true })
          .evaluate((element) => ({
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
          }));
        expect(nameLayout.scrollWidth).toBeLessThanOrEqual(nameLayout.width);
        await expect(page.locator("article")).toHaveCSS(
          "border-bottom-width",
          "2px",
        );
        await header.screenshot({
          path: test.info().outputPath(`header-${width}.png`),
        });
      }
    });
  }
}
