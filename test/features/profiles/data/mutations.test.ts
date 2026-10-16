import { describe, expect, it } from "vitest";

import {
  readProfileEditFailure,
  readProfileEditForm,
  validateProfileEdit,
} from "~/features/profiles/data/mutations";

describe("profile public ID errors", () => {
  it.each([
    ["bad id", "영문 소문자·숫자·하이픈으로 5~15자를 입력해 주세요."],
    ["admin", "사용할 수 없는 ID입니다."],
  ])("explains the rejected ID %s in user-facing terms", (pubId, message) => {
    const formData = new FormData();
    formData.set("pubId", pubId);
    formData.set("name", "테스트 교사");

    expect(
      validateProfileEdit(readProfileEditForm(formData), "teacher").pubId,
    ).toBe(message);
  });

  it.each([
    [{ code: "23505" }, "이미 사용 중인 ID입니다."],
    [
      { code: "23514", message: "profiles_pub_id_not_reserved" },
      "사용할 수 없는 ID입니다. 다른 ID를 입력해 주세요.",
    ],
  ])(
    "explains the server rejection %o next to the ID field",
    (error, message) => {
      expect(readProfileEditFailure(error)).toEqual({ pubId: message });
    },
  );
});
