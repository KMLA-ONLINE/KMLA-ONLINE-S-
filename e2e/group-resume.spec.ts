import { expect, test } from "@playwright/test";
import type { Database } from "../app/shared/supabase/database.types";

type PostRow =
  Database["public"]["Functions"]["list_group_posts"]["Returns"][number];

// Pagination responses are synthetic: no posts or membership changes are written to the DB.
const rows: PostRow[] = Array.from({ length: 36 }, (_, index) => ({
  post_id: `90000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
  group_id: "20000000-0000-0000-0000-000000000001",
  category_id: "",
  category_name: "",
  title: `복귀 테스트 게시물 ${index + 1}`,
  body: "테스트 본문",
  attachments: [],
  mentions: [],
  author_identity: "identified",
  author_pub_id: "student",
  author_name: "테스트",
  author_label: "테스트",
  author_avatar_path: "",
  is_pinned: false,
  published_at: "2026-10-13T00:00:00Z",
  edited_at: "",
  comment_count: 0,
  reaction_count: 0,
  top_reactions: [],
  my_reaction: "like",
  is_author: false,
  can_edit: false,
  can_delete: false,
  can_pin: false,
  can_moderate_anonymous: false,
  anonymous_author_restricted: false,
  anonymous_author_restriction_expires_at: "",
}));

for (const position of ["top", "bottom"] as const) {
  test(`tab/window resume preserves loaded posts and scroll at ${position}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      localStorage.setItem("kmla-online:posts-view:v1", "list");
      localStorage.setItem(
        "kmla-online:pwa-install-preference",
        JSON.stringify({ dismissCount: 0, installed: false, neverShow: true }),
      );
    });
    let postRequests = 0;
    let accessResponses = 0;
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (
        url.pathname === "/rest/v1/groups" &&
        url.searchParams.get("slug") === "eq.school-notices"
      )
        accessResponses++;
    });
    await page.route("**/rest/v1/rpc/list_group_posts", async (route) => {
      postRequests++;
      const body = route.request().postDataJSON() as {
        p_cursor_post_id?: string;
        p_limit: number;
      };
      const start = body.p_cursor_post_id
        ? Number(body.p_cursor_post_id.slice(-12))
        : 0;
      await route.fulfill({ json: rows.slice(start, start + body.p_limit) });
    });
    // Visiting the list should not modify even the seed account's visit marker in this test.
    await page.route("**/rest/v1/rpc/list_group_pinned_posts", (route) =>
      route.fulfill({ json: [] }),
    );
    await page.route("**/rest/v1/rpc/mark_group_posts_visited", (route) =>
      route.fulfill({ json: null }),
    );
    await page.goto("/login");
    await page.getByLabel("이메일").fill("student@kmla.hs.kr");
    await page.getByLabel("비밀번호", { exact: true }).fill("password123");
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/groups/school-notices");
    const section = page.getByRole("region", { name: "그룹 게시물" });
    const posts = section.locator("li");
    const scroll = page.getByRole("main");
    await expect(posts).toHaveCount(12);
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(posts).toHaveCount(24);
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(posts).toHaveCount(36);
    await scroll.evaluate((element, where) => {
      element.scrollTop = where === "top" ? 0 : element.scrollHeight;
    }, position);
    const beforeScroll = await scroll.evaluate((element) => element.scrollTop);
    const beforeRequests = postRequests;
    const beforeAccess = accessResponses;
    await page.evaluate(() => {
      const state = window as Window & { resumePostCounts?: number[] };
      state.resumePostCounts = [
        document.querySelectorAll('section[aria-label="그룹 게시물"] li')
          .length,
      ];
      const section = document.querySelector(
        'section[aria-label="그룹 게시물"]',
      );
      if (!section) throw new Error("group posts are not mounted");
      new MutationObserver(() => {
        state.resumePostCounts?.push(
          document.querySelectorAll('section[aria-label="그룹 게시물"] li')
            .length,
        );
      }).observe(section.parentElement ?? section, {
        childList: true,
        subtree: true,
      });
    });
    const otherTab = await context.newPage();
    await otherTab.goto("about:blank");
    await otherTab.bringToFront();
    await page.bringToFront();
    // Explicit signals also cover headless environments that do not emit native window focus.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => accessResponses).toBeGreaterThan(beforeAccess);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(posts).toHaveCount(36);
    expect(postRequests).toBe(beforeRequests);
    expect(await scroll.evaluate((element) => element.scrollTop)).toBe(
      beforeScroll,
    );
    expect(
      await page.evaluate(() =>
        Math.min(
          ...((window as Window & { resumePostCounts?: number[] })
            .resumePostCounts ?? [0]),
        ),
      ),
    ).toBe(36);
    await otherTab.close();
  });
}
