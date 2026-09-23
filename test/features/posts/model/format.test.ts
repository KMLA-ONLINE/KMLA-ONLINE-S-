import { describe, expect, it } from "vitest";

import {
  getAnonymousActivityRestrictionErrorMessage,
  getCommentErrorMessage,
  getPostErrorMessage,
} from "~/features/posts/model/format";

describe("anonymous activity restriction error messages", () => {
  it("maps write rejection and moderation conflicts to Korean messages", () => {
    const writeError = { message: "anonymous activity is restricted" };
    expect(getPostErrorMessage(writeError)).toBe(
      "이 그룹에서는 현재 익명 활동이 제한되어 있습니다.",
    );
    expect(getCommentErrorMessage(writeError)).toBe(
      "이 그룹에서는 현재 익명 활동이 제한되어 있습니다.",
    );
    expect(
      getAnonymousActivityRestrictionErrorMessage({
        message: "anonymous activity restriction already active",
      }),
    ).toBe("이미 익명 활동이 차단된 사용자입니다.");
    expect(
      getAnonymousActivityRestrictionErrorMessage({
        message: "anonymous activity restriction already cancelled",
      }),
    ).toBe("이미 해제되었거나 만료된 익명 활동 차단입니다.");
  });
});
