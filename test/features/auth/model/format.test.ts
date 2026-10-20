import { describe, expect, it } from "vitest";

import {
  getAuthErrorMessage,
  isEmailNotConfirmedError,
} from "~/features/auth/model/format";

describe("auth error format", () => {
  it("recognizes only an unconfirmed-email sign-in failure", () => {
    expect(isEmailNotConfirmedError({ code: "email_not_confirmed" })).toBe(
      true,
    );
    expect(isEmailNotConfirmedError({ code: "invalid_credentials" })).toBe(
      false,
    );
    expect(isEmailNotConfirmedError(new Error("offline"))).toBe(false);
    expect(isEmailNotConfirmedError(null)).toBe(false);
  });

  // 로그인 화면에선 코드를 받을 수 없으니 다시 가입하는 길을 문구가 알려 줘야 한다.
  it("tells an unconfirmed account how to get a new code", () => {
    expect(getAuthErrorMessage({ code: "email_not_confirmed" })).toContain(
      "같은 이메일로 다시 가입",
    );
  });

  // DB가 새 판을 요구하는데 화면이 옛 판을 보냈다. 다시 시도해도 같은 판이 가므로 새로고침을 안내한다.
  it("asks to reload when the server requires newer terms", () => {
    expect(
      getAuthErrorMessage({
        code: "22023",
        message: "current terms agreement required",
      }),
    ).toBe("앱이 새 버전으로 바뀌었어요. 새로고침한 뒤 다시 시도해 주세요.");
    expect(
      getAuthErrorMessage({
        code: "22023",
        message: "academic profile fields are required",
      }),
    ).toBe("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  });

  it("falls back to a generic message for unknown failures", () => {
    expect(getAuthErrorMessage(new Error("boom"))).toBe(
      "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  });
});
