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

/** 가입 마법사가 단계마다 다른 오류 타입을 들고 다니지 않게 오류를 한 타입으로 모은다. */
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
