import { describe, expect, it } from "vitest";

import {
  createPostListRevalidation,
  shouldRevalidatePostDetail,
} from "~/features/posts/model/revalidation";

function args(current: string, next: string, formMethod?: string) {
  return {
    currentUrl: new URL(current),
    nextUrl: new URL(next),
    formMethod,
    defaultShouldRevalidate: true,
  } as never;
}

describe("shouldRevalidatePostDetail", () => {
  it("keeps expanded replies while an image viewer opens and closes", () => {
    expect(
      shouldRevalidatePostDetail(
        args(
          "https://kmla.online/groups/test/posts/post-id",
          "https://kmla.online/groups/test/posts/post-id?image=reply-image",
        ),
      ),
    ).toBe(false);
    expect(
      shouldRevalidatePostDetail(
        args(
          "https://kmla.online/groups/test/posts/post-id?image=reply-image",
          "https://kmla.online/groups/test/posts/post-id",
        ),
      ),
    ).toBe(false);
  });

  it("does not reload detail data when switching to the comment sheet", () => {
    expect(
      shouldRevalidatePostDetail(
        args(
          "https://kmla.online/groups/test/posts/post-id",
          "https://kmla.online/groups/test/posts/post-id?view=comments",
        ),
      ),
    ).toBe(false);
  });

  it("still revalidates for other query changes and mutations", () => {
    expect(
      shouldRevalidatePostDetail(
        args(
          "https://kmla.online/groups/test/posts/post-id",
          "https://kmla.online/groups/test/posts/post-id?other=value",
        ),
      ),
    ).toBe(true);
    expect(
      shouldRevalidatePostDetail(
        args(
          "https://kmla.online/groups/test/posts/post-id",
          "https://kmla.online/groups/test/posts/post-id?image=photo",
          "POST",
        ),
      ),
    ).toBe(true);
  });
});

describe("createPostListRevalidation", () => {
  const feed = createPostListRevalidation(["post", "kind", "source"]);
  const profile = createPostListRevalidation();

  // 회귀: `image`가 목록 규칙에서 빠져 있어 활동 이미지를 여닫을 때마다 새 피드 세션이 열렸다.
  it("keeps the feed session while an image viewer opens and closes", () => {
    expect(
      feed(
        args(
          "https://kmla.online/",
          "https://kmla.online/?image=profile-activity-post-id",
        ),
      ),
    ).toBe(false);
    expect(
      feed(
        args(
          "https://kmla.online/?image=profile-activity-post-id",
          "https://kmla.online/",
        ),
      ),
    ).toBe(false);
  });

  it("keeps a profile timeline while an image viewer opens over the post overlay", () => {
    expect(
      profile(
        args(
          "https://kmla.online/profile/jieun-29",
          "https://kmla.online/profile/jieun-29?image=attachment-id",
        ),
      ),
    ).toBe(false);
  });

  it("still reloads for parameters the loader reads", () => {
    expect(
      feed(
        args(
          "https://kmla.online/?image=photo",
          "https://kmla.online/?image=photo&pageToken=token",
        ),
      ),
    ).toBe(true);
  });

  it("ignores search parameter order", () => {
    expect(
      feed(
        args(
          "https://kmla.online/?post=post-id&image=photo",
          "https://kmla.online/?image=photo&post=post-id",
        ),
      ),
    ).toBe(false);
  });

  it("reloads for mutations and explicit same-url refreshes", () => {
    expect(feed(args("https://kmla.online/", "https://kmla.online/"))).toBe(
      true,
    );
    expect(
      feed(
        args(
          "https://kmla.online/",
          "https://kmla.online/?image=photo",
          "POST",
        ),
      ),
    ).toBe(true);
  });
});
