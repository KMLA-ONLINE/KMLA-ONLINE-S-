import { getSupabase } from "~/shared/supabase/client";
import {
  clearPendingSignupEmail,
  setPendingSignupEmail,
} from "~/features/auth/data/queries";
import type { ProfileFormValues } from "~/features/auth/model/types";

function optionalNumber(value: string): number | undefined {
  return value ? Number(value) : undefined;
}

export function getAuthErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";

  if (code === "invalid_credentials") {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (code === "email_not_confirmed") {
    return "이메일 인증을 먼저 완료해 주세요.";
  }
  if (code === "user_already_exists" || code === "email_exists") {
    return "이미 가입된 이메일입니다.";
  }
  if (code === "otp_expired" || code === "otp_disabled") {
    return "인증 코드가 만료되었거나 올바르지 않습니다.";
  }
  if (code === "over_email_send_rate_limit") {
    return "인증 메일을 너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요.";
  }

  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
}

export async function signUp(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signUp({ email, password });
  if (error) throw error;
  setPendingSignupEmail(email);
}

export async function verifySignupOtp(
  email: string,
  token: string,
): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) throw error;
}

export async function resendSignupOtp(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resend({
    email,
    type: "signup",
  });
  if (error) throw error;
}

export async function submitProfile(values: ProfileFormValues): Promise<void> {
  const { error } = await getSupabase().rpc("submit_my_profile", {
    p_name: values.name,
    p_type: values.type as "student" | "alumni" | "teacher",
    p_student_number: values.studentNumber || undefined,
    p_class_no: optionalNumber(values.classNo),
    p_cohort: optionalNumber(values.cohort),
    p_gender: (values.gender || undefined) as "male" | "female" | undefined,
    p_academic_track: (values.academicTrack || undefined) as
      "domestic" | "international" | undefined,
    p_phone_number: values.phoneNumber || undefined,
    p_birthday: values.birthday || undefined,
    p_dorm_room: optionalNumber(values.dormRoom),
  });

  if (error) throw error;
  clearPendingSignupEmail();
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();

  if (error) throw error;
  clearPendingSignupEmail();
}
