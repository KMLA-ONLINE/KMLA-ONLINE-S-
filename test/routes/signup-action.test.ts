import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimSignupPassword,
  hasActiveSession,
  submitProfile,
  verifySignupOtp,
} = vi.hoisted(() => ({
  claimSignupPassword: vi.fn(),
  hasActiveSession: vi.fn(),
  submitProfile: vi.fn(),
  verifySignupOtp: vi.fn(),
}));

vi.mock("~/features/auth/data/mutations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  claimSignupPassword,
  submitProfile,
  verifySignupOtp,
}));
vi.mock("~/features/auth/data/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hasActiveSession,
}));

import { clearSignupDraft, saveSignupDraft } from "~/features/auth";
import { clientAction } from "~/routes/auth/signup";

const email = "student@kmla.hs.kr";
const values = {
  academicTrack: "",
  birthday: "",
  classNo: "",
  cohort: "31",
  dormRoom: "",
  gender: "",
  name: "홍길동",
  phoneNumber: "",
  studentNumber: "",
  type: "student",
};

function verify(fields: Record<string, string>) {
  const body = new FormData();
  body.set("intent", "verify");
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const request = new Request("http://localhost/signup", {
    method: "POST",
    body,
  });
  return (clientAction as (args: { request: Request }) => Promise<unknown>)({
    request,
  });
}

async function expectRedirect(result: Promise<unknown>, location: string) {
  const response = await result.catch((error: unknown) => error);
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).headers.get("Location")).toBe(location);
}

describe("signup verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSignupDraft();
    saveSignupDraft({ email, values });
    hasActiveSession.mockResolvedValue(false);
    verifySignupOtp.mockResolvedValue(undefined);
    claimSignupPassword.mockResolvedValue(undefined);
    submitProfile.mockResolvedValue(undefined);
  });

  // 인증 전 계정에 다시 가입하면 Auth는 처음 비밀번호를 유지한다. 코드로 이메일을 증명한
  // 직후에 이번 비밀번호를 저장해야 다음 로그인이 통한다.
  it("claims the password chosen in this attempt right after the code checks out", async () => {
    await expectRedirect(
      verify({ otp: "123456", password: "new-password" }),
      "/pending",
    );

    expect(claimSignupPassword).toHaveBeenCalledWith("new-password");
    expect(verifySignupOtp.mock.invocationCallOrder[0]).toBeLessThan(
      claimSignupPassword.mock.invocationCallOrder[0],
    );
    expect(claimSignupPassword.mock.invocationCallOrder[0]).toBeLessThan(
      submitProfile.mock.invocationCallOrder[0],
    );
  });

  // 다시 로드돼 비밀번호를 잃으면 저장을 건너뛸 게 아니라 다시 받아야 한다. 건너뛰면
  // 남이 먼저 만들어 둔 계정의 비밀번호가 살아남는다.
  it("asks for the password again after a reload instead of skipping the claim", async () => {
    const missing = (await verify({ otp: "123456", password: "" })) as {
      data: { askPassword: boolean; errors: Record<string, string> };
    };
    expect(missing.data.askPassword).toBe(true);
    expect(missing.data.errors.password).toBeTruthy();
    expect(verifySignupOtp).not.toHaveBeenCalled();

    const mismatched = (await verify({
      otp: "123456",
      password: "new-password",
      passwordConfirm: "other-password",
    })) as { data: { errors: Record<string, string> } };
    expect(mismatched.data.errors.passwordConfirm).toBeTruthy();
    expect(verifySignupOtp).not.toHaveBeenCalled();

    await expectRedirect(
      verify({
        otp: "123456",
        password: "new-password",
        passwordConfirm: "new-password",
      }),
      "/pending",
    );
    expect(claimSignupPassword).toHaveBeenCalledWith("new-password");
  });

  // 서버가 비밀번호를 거절했는데 hidden 값만 다시 보내면 빠져나올 수 없다.
  it("lets the user change a rejected password after verification succeeded", async () => {
    claimSignupPassword.mockRejectedValueOnce({ code: "weak_password" });
    hasActiveSession.mockResolvedValueOnce(false).mockResolvedValue(true);

    const failed = (await verify({
      otp: "123456",
      password: "new-password",
    })) as { data: { askPassword: boolean; verified: boolean } };
    expect(failed.data).toMatchObject({ askPassword: true, verified: true });
    expect(submitProfile).not.toHaveBeenCalled();

    await expectRedirect(
      verify({
        password: "better-password",
        passwordConfirm: "better-password",
      }),
      "/pending",
    );
    expect(verifySignupOtp).toHaveBeenCalledOnce();
    expect(claimSignupPassword).toHaveBeenLastCalledWith("better-password");
  });
});
