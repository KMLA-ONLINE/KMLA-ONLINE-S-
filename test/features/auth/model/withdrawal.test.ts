import { describe, expect, it } from "vitest";

import {
  describeWithdrawalError,
  getWithdrawalBlockers,
} from "~/features/auth/model/withdrawal";

const MAKERS = { id: "g1", slug: "makers-lab", name: "메이커스 랩" };

describe("withdrawal blockers", () => {
  it("lets an ordinary member withdraw", () => {
    expect(getWithdrawalBlockers({ role: "member", ownedGroups: [] })).toEqual(
      [],
    );
  });

  it("asks an app administrator to give up the role first", () => {
    expect(getWithdrawalBlockers({ role: "admin", ownedGroups: [] })).toEqual([
      { kind: "app_admin" },
    ]);
  });

  it("lists the groups an owner has to hand over", () => {
    expect(
      getWithdrawalBlockers({ role: "admin", ownedGroups: [MAKERS] }),
    ).toEqual([
      { kind: "app_admin" },
      { kind: "group_owner", groups: [MAKERS] },
    ]);
  });
});

describe("withdrawal error", () => {
  it("puts a wrong password on the password field without mentioning the email", () => {
    expect(describeWithdrawalError({ code: "invalid_credentials" })).toEqual({
      field: "password",
      message: "비밀번호가 올바르지 않습니다.",
    });
  });

  it("explains a group ownership that appeared after the screen loaded", () => {
    expect(
      describeWithdrawalError({
        code: "55000",
        message: "group ownership must be transferred before withdrawal",
        hint: "group_owner",
      }),
    ).toEqual({
      field: "form",
      message:
        "소유한 그룹이 있어 탈퇴할 수 없습니다. 먼저 소유권을 넘겨 주세요.",
    });
  });

  it("explains an app administrator role", () => {
    expect(
      describeWithdrawalError({
        code: "55000",
        message: "app administrator role must be released before withdrawal",
        hint: "app_admin",
      }),
    ).toEqual({
      field: "form",
      message:
        "앱 관리자는 탈퇴할 수 없습니다. 다른 앱 관리자에게 강등을 요청해 주세요.",
    });
  });

  it("falls back to a generic form message", () => {
    expect(describeWithdrawalError(new Error("network"))).toEqual({
      field: "form",
      message: "탈퇴하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
  });
});
