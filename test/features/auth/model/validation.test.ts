import { describe, expect, it } from "vitest";

import {
  hasErrors,
  validateEmail,
  validatePassword,
  validateProfileForm,
} from "~/features/auth/model/validation";
import type { ProfileFormValues } from "~/features/auth/model/types";

const STUDENT: ProfileFormValues = {
  name: "홍길동",
  type: "student",
  studentNumber: "240001",
  classNo: "1",
  cohort: "29",
  gender: "male",
  academicTrack: "domestic",
  phoneNumber: "010-1234-5678",
  birthday: "2007-01-01",
  dormRoom: "301",
  otp: "123456",
};

describe("auth validation", () => {
  it("validates account credentials", () => {
    expect(validateEmail("invalid")).toBeDefined();
    expect(validateEmail("student@kmla.hs.kr")).toBeUndefined();
    expect(validatePassword("12345")).toBeDefined();
    expect(validatePassword("123456")).toBeUndefined();
    expect(hasErrors({ email: undefined, password: undefined })).toBe(false);
  });

  it("accepts a complete student profile", () => {
    expect(validateProfileForm(STUDENT, true)).toEqual({});
  });

  it("requires student academic fields and a six-digit OTP", () => {
    const errors = validateProfileForm(
      {
        ...STUDENT,
        studentNumber: "24A001",
        academicTrack: "",
        otp: "123",
      },
      true,
    );

    expect(errors.studentNumber).toMatch(/숫자 6자리/);
    expect(errors.academicTrack).toBeDefined();
    expect(errors.otp).toBeDefined();
    expect(hasErrors(errors)).toBe(true);
  });

  it("does not require academic fields for teachers", () => {
    const errors = validateProfileForm(
      {
        ...STUDENT,
        type: "teacher",
        studentNumber: "",
        classNo: "",
        cohort: "",
        gender: "",
        academicTrack: "",
        birthday: "",
        dormRoom: "",
        otp: "",
      },
      false,
    );

    expect(errors).toEqual({});
  });
});
