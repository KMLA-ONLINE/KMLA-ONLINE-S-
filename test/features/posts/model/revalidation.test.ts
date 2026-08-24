import { describe, expect, it } from "vitest";

import { shouldRevalidatePostDetail } from "~/features/posts/model/revalidation";

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

  it("still revalidates for other query changes and mutations", () => {
    expect(
      shouldRevalidatePostDetail(
        args(
          "https://kmla.online/groups/test/posts/post-id",
          "https://kmla.online/groups/test/posts/post-id?view=comments",
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
