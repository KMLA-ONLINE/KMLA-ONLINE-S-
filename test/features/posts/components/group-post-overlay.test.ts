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
  const initial = {
    title: "제목",
    body: "본문",
    categoryId: "category",
    authorIdentity: "identified" as const,
  };

  it("considers every entered field and attachments for new posts", () => {
    for (const change of [
      { title: "새 제목" },
      { categoryId: "other" },
      { authorIdentity: "anonymous" as const },
    ]) {
      expect(
        isPostDraftDirty({
          mode: "create",
          initial: { ...initial, title: "", body: "", categoryId: "" },
          title: "",
          body: "",
          categoryId: "",
          authorIdentity: "identified",
          attachmentsChanged: false,
          ...change,
        }),
      ).toBe(true);
    }
    expect(
      isPostDraftDirty({
        mode: "create",
        initial: { ...initial, title: "", body: "", categoryId: "" },
        title: "",
        body: "작성 중",
        categoryId: "",
        authorIdentity: "identified",
        attachmentsChanged: false,
      }),
    ).toBe(true);
    expect(
      isPostDraftDirty({
        mode: "create",
        initial: { ...initial, title: "", body: "", categoryId: "" },
        title: "",
        body: "",
        categoryId: "",
        authorIdentity: "identified",
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
        authorIdentity: initial.authorIdentity,
        attachmentsChanged: false,
      }),
    ).toBe(false);

    for (const change of [
      { title: "다른 제목" },
      { body: "다른 본문" },
      { categoryId: "other" },
      { authorIdentity: "staff" as const },
      { attachmentsChanged: true },
    ]) {
      expect(
        isPostDraftDirty({
          mode: "edit",
          initial,
          title: initial.title,
          body: initial.body,
          categoryId: initial.categoryId,
          authorIdentity: initial.authorIdentity,
          attachmentsChanged: false,
          ...change,
        }),
      ).toBe(true);
    }
  });
});
