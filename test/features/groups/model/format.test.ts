import { describe, expect, it } from "vitest";

import {
  getGroupErrorMessage,
  getGroupIdentityPolicyLabel,
  getGroupInviteProfileTypeLabel,
  getGroupJoinPolicyLabel,
  getGroupKindLabel,
  getGroupMemberRoleLabel,
  getGroupPostingPolicyLabel,
  hasMinimumGroupSearchLength,
  normalizeGroupSearchInput,
} from "~/features/groups/model/format";

describe("group invite errors", () => {
  it("explains an unavailable invite without changing other missing-resource errors", () => {
    expect(
      getGroupErrorMessage({ code: "P0002", message: "invite not found" }),
    ).toBe("사용할 수 없는 초대 링크입니다.");
    expect(
      getGroupErrorMessage({ code: "P0002", message: "group not found" }),
    ).toBe("그룹을 찾을 수 없습니다.");
  });
});

describe("group search input", () => {
  it("accepts a one-character Korean group name", () => {
    expect(hasMinimumGroupSearchLength("한")).toBe(true);
    expect(hasMinimumGroupSearchLength("한글")).toBe(true);
  });

  it("normalizes composed Korean and surrounding whitespace", () => {
    expect(normalizeGroupSearchInput("  한글  ")).toBe("한글");
    expect(hasMinimumGroupSearchLength("  한  ")).toBe(true);
  });
});

describe("group labels and errors in English", () => {
  it("translates policy, role and kind labels", () => {
    expect(getGroupJoinPolicyLabel("request", "en")).toBe("Approval required");
    expect(getGroupIdentityPolicyLabel("optional_anonymous", "en")).toBe(
      "Anonymous optional",
    );
    expect(getGroupPostingPolicyLabel("staff", "en")).toBe("Staff only");
    expect(getGroupMemberRoleLabel("manager", "en")).toBe("Manager");
    expect(getGroupKindLabel("official", "en")).toBe("Official group");
    expect(getGroupInviteProfileTypeLabel("alumni", "en")).toBe("Alumni");
    expect(getGroupMemberRoleLabel("manager")).toBe("매니저");
  });

  it("translates error messages", () => {
    expect(getGroupErrorMessage({ code: "42501" }, "en")).toBe(
      "You don't have permission to do this.",
    );
    expect(getGroupErrorMessage({ code: "42501" })).toBe(
      "이 작업을 수행할 권한이 없습니다.",
    );
  });
});
