import type { Database } from "~/shared/supabase/database.types";

export type AuthProfile =
  Database["public"]["Functions"]["get_my_profile"]["Returns"][number];

export interface AuthState {
  email: string;
  profile: AuthProfile | null;
}

export interface ProfileFormValues {
  name: string;
  type: string;
  studentNumber: string;
  classNo: string;
  cohort: string;
  gender: string;
  academicTrack: string;
  phoneNumber: string;
  birthday: string;
  dormRoom: string;
}

/**
 * 계정 입력과 이메일 인증은 프로필과 다른 단계에 있지만 오류는 한 자리에 모인다.
 * 가입 마법사가 단계마다 다른 오류 타입을 들고 다니지 않게 하려는 것이다.
 */
export type FieldErrors = Partial<
  Record<
    | keyof ProfileFormValues
    | "form"
    | "email"
    | "password"
    | "passwordConfirm"
    | "otp",
    string
  >
>;
