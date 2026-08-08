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
  otp: string;
}

export type FieldErrors = Partial<
  Record<keyof ProfileFormValues | "form", string>
>;
