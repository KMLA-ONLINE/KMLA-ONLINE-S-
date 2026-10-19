import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimSignupPassword,
  hasActiveSession,
  signUp,
  submitProfile,
  verifySignupOtp,
} = vi.hoisted(() => ({
  claimSignupPassword: vi.fn(),
  hasActiveSession: vi.fn(),
  signUp: vi.fn(),
  submitProfile: vi.fn(),
  verifySignupOtp: vi.fn(),
}));

vi.mock("~/features/auth/data/mutations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  claimSignupPassword,
  signUp,
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
    saveSignupDraft({ email, values, termsVersion: "2026-10-20" });
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

  it("submits the profile together with the terms version agreed earlier", async () => {
    await expectRedirect(
      verify({ otp: "123456", password: "new-password" }),
      "/pending",
    );

    expect(submitProfile).toHaveBeenCalledWith(values, "2026-10-20");
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

  // 인증 단계에는 학번 칸이 없으므로 폼 오류로 이유를 알린다.
  it("explains a student number that is already registered", async () => {
    submitProfile.mockRejectedValueOnce({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "profiles_student_number_key"',
    });

    const failed = (await verify({
      otp: "123456",
      password: "new-password",
    })) as {
      data: { errors: Record<string, string>; studentNumberTaken?: boolean };
    };

    expect(failed.data.errors.form).toBe(
      "이미 등록된 학번입니다. 학번을 확인하고, 맞다면 관리자에게 문의해 주세요.",
    );
    // 다시 제출해도 같은 학번이면 또 실패한다. 화면은 재제출 대신 학번을 고칠 곳을 안내한다.
    expect(failed.data).toMatchObject({ studentNumberTaken: true });
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

describe("signup profile step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSignupDraft();
  });

  // 호스팅 Auth는 메일을 받을 수 없는 주소를 계정 생성 때 거절한다. 이메일 칸은 첫 단계에
  // 있으므로 그 단계로 돌려보내야 고칠 수 있고, 입력한 프로필은 남아 있어야 한다.
  it("sends a rejected email back to the account step with the profile kept", async () => {
    signUp.mockRejectedValueOnce({ code: "email_address_invalid" });
    const body = new FormData();
    body.set("intent", "profile");
    body.set("email", "someone@invalid-domain.test");
    body.set("password", "new-password");
    body.set("name", "홍길동");
    body.set("type", "student");
    body.set("studentNumber", "260001");
    body.set("cohort", "31");
    body.set("gender", "female");
    body.set("academicTrack", "domestic");
    body.set("birthdayYear", "2009");
    body.set("birthdayMonth", "03");
    body.set("birthdayDay", "01");
    body.set("terms", "2026-10-20");
    const request = new Request("http://localhost/signup", {
      method: "POST",
      body,
    });

    const result = (await (
      clientAction as (args: { request: Request }) => Promise<unknown>
    )({ request })) as {
      data: {
        step: string;
        email: string;
        values: { studentNumber: string };
        errors: Record<string, string>;
      };
    };

    expect(result.data.step).toBe("credentials");
    expect(result.data.email).toBe("someone@invalid-domain.test");
    expect(result.data.values.studentNumber).toBe("260001");
    expect(result.data.errors).toEqual({
      email:
        "사용할 수 없는 이메일 주소입니다. 메일을 받을 수 있는 주소를 입력해 주세요.",
    });
  });
});

function submitStep(intent: string, fields: Record<string, string> = {}) {
  const body = new FormData();
  body.set("intent", intent);
  body.set("email", email);
  body.set("password", "new-password");
  body.set("passwordConfirm", "new-password");
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const request = new Request("http://localhost/signup", {
    method: "POST",
    body,
  });
  return (
    clientAction as unknown as (args: { request: Request }) => Promise<{
      data: {
        step: string;
        termsAgreed?: boolean;
        errors?: Record<string, string>;
      };
    }>
  )({ request });
}

describe("signup terms step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSignupDraft();
    signUp.mockResolvedValue(undefined);
  });

  // 서버가 학교 프로필을 받기 전에 약관과 개인정보 안내가 끝나야 한다.
  it("shows the terms right after the account step", async () => {
    const result = await submitStep("credentials");
    expect(result.data.step).toBe("terms");
  });

  it("keeps the user on the terms step until the terms are agreed", async () => {
    const result = await submitStep("terms");
    expect(result.data.step).toBe("terms");
    expect(result.data.errors?.terms).toBeTruthy();
  });

  it("opens the profile step once the terms are agreed", async () => {
    const result = await submitStep("terms", { terms: "2026-10-20" });
    expect(result.data).toMatchObject({ step: "profile", termsAgreed: true });
  });

  it("does not create the account for a profile submitted without agreement", async () => {
    const result = await submitStep("profile");
    expect(result.data.step).toBe("terms");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("keeps the agreement while going back from the profile to the terms", async () => {
    const back = await submitStep("back", {
      step: "profile",
      terms: "2026-10-20",
    });
    expect(back.data).toMatchObject({ step: "terms", termsAgreed: true });

    const first = await submitStep("back", { step: "terms" });
    expect(first.data.step).toBe("credentials");
  });
});
