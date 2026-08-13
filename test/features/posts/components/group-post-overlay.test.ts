import { describe, expect, it } from "vitest";

import {
  isPostDraftDirty,
  needsPostIdentityConfirmation,
} from "~/features/posts/components/group-post-overlay";

describe("needsPostIdentityConfirmation", () => {
  it("confirms anonymous and staff identities in ordinary groups", () => {
    expect(needsPostIdentityConfirmation("identified", false)).toBe(false);
    expect(needsPostIdentityConfirmation("anonymous", false)).toBe(true);
    expect(needsPostIdentityConfirmation("staff", false)).toBe(true);
  });

  it("does not confirm anonymous identity in always-anonymous groups", () => {
    expect(needsPostIdentityConfirmation("anonymous", true)).toBe(false);
    expect(needsPostIdentityConfirmation("staff", true)).toBe(true);
  });
});

describe("isPostDraftDirty", () => {
  const initial = { title: "제목", body: "본문", categoryId: "category" };

  it("only considers body and attachments for new posts", () => {
    expect(
      isPostDraftDirty({
        mode: "create",
        initial,
        title: "바꾼 제목",
        body: "  ",
        categoryId: "other",
        attachmentsChanged: false,
      }),
    ).toBe(false);
    expect(
      isPostDraftDirty({
        mode: "create",
        initial,
        title: "",
        body: "작성 중",
        categoryId: "",
        attachmentsChanged: false,
      }),
    ).toBe(true);
    expect(
      isPostDraftDirty({
        mode: "create",
        initial,
        title: "",
        body: "",
        categoryId: "",
        attachmentsChanged: true,
      }),
    ).toBe(true);
  });

  it("considers every editable field and attachments for edits", () => {
    expect(
      isPostDraftDirty({
        mode: "edit",
        initial,
        title: initial.title,
        body: initial.body,
        categoryId: initial.categoryId,
        attachmentsChanged: false,
      }),
    ).toBe(false);

    for (const change of [
      { title: "다른 제목" },
      { body: "다른 본문" },
      { categoryId: "other" },
      { attachmentsChanged: true },
    ]) {
      expect(
        isPostDraftDirty({
          mode: "edit",
          initial,
          title: initial.title,
          body: initial.body,
          categoryId: initial.categoryId,
          attachmentsChanged: false,
          ...change,
        }),
      ).toBe(true);
    }
  });
});
