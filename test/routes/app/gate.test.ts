import { describe, expect, it } from "vitest";

import { shouldRevalidate } from "~/routes/app/gate";

function afterSubmit(formAction: string, formMethod = "POST") {
  const url = new URL("https://example.com/groups/private-club");
  return shouldRevalidate({
    currentUrl: url,
    nextUrl: url,
    formMethod,
    formAction,
  } as never);
}

describe("app gate revalidation", () => {
  it("does not reload the profile for an explicit child-route refresh", () => {
    const url = new URL("https://example.com/groups/private-club?tab=members");

    expect(shouldRevalidate({ currentUrl: url, nextUrl: url } as never)).toBe(
      false,
    );
  });

  it("does not reload the profile on navigation", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/groups"),
        nextUrl: new URL("https://example.com/noti"),
      } as never),
    ).toBe(false);
  });

  it("reloads the profile after a mutation that changes it", () => {
    expect(afterSubmit("/profile/student/edit")).toBe(true);
    expect(afterSubmit("/admin/app-admins")).toBe(true);
  });

  it("reloads the badge after marking notifications read", () => {
    expect(afterSubmit("/noti")).toBe(true);
  });

  // 댓글·반응·그룹 관리처럼 셸과 무관한 mutation 뒤에 셸 RPC를 다시 보내지 않는다.
  it("skips mutations that cannot change shell data", () => {
    expect(afterSubmit("/groups/private-club")).toBe(false);
    expect(afterSubmit("/groups/private-club/posts/post-id?index")).toBe(false);
    expect(afterSubmit("/profile/student/posts/post-id")).toBe(false);
    expect(afterSubmit("/noti/settings")).toBe(false);
  });
});
