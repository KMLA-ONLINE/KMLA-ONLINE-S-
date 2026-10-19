import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitProfile } = vi.hoisted(() => ({ submitProfile: vi.fn() }));

vi.mock("~/features/auth/data/mutations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  submitProfile,
}));

import { clientAction } from "~/routes/auth/setup";

const values = {
  academicTrack: "domestic",
  birthdayYear: "2009",
  birthdayMonth: "03",
  birthdayDay: "01",
  cohort: "31",
  gender: "female",
  name: "홍길동",
  phoneNumber: "",
  studentNumber: "260001",
  type: "student",
};

function submit(fields: Record<string, string> = { terms: "2026-10-20" }) {
  const body = new FormData();
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const request = new Request("http://localhost/setup", {
    method: "POST",
    body,
  });
  return (clientAction as (args: { request: Request }) => Promise<unknown>)({
    request,
  });
}

describe("profile setup submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 학번은 계정 사이에서 고유하다. 이미 쓰인 학번이면 일반 오류 대신 학번 칸에서 알려야
  // 사용자가 무엇을 고칠지 안다.
  it("points at the student number when it is already registered", async () => {
    submitProfile.mockRejectedValueOnce({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "profiles_student_number_key"',
    });

    const result = (await submit()) as {
      data: { errors: Record<string, string> };
    };

    expect(result.data.errors).toEqual({
      studentNumber:
        "이미 등록된 학번입니다. 학번을 확인하고, 맞다면 관리자에게 문의해 주세요.",
    });
  });

  // 차단이 풀려 다시 제출하는 사람도 가입 신청이므로 약관에 동의해야 한다.
  it("does not submit without agreeing to the terms", async () => {
    const result = (await submit({})) as {
      data: { errors: Record<string, string> };
    };

    expect(result.data.errors.terms).toBeTruthy();
    expect(submitProfile).not.toHaveBeenCalled();
  });

  it("submits the profile with the agreed terms version", async () => {
    submitProfile.mockResolvedValueOnce(undefined);

    const response = await submit().catch((error: unknown) => error);

    expect((response as Response).headers.get("Location")).toBe("/pending");
    expect(submitProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "홍길동" }),
      "2026-10-20",
    );
  });
});
