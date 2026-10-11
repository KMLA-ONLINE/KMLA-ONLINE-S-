import { getSupabase } from "~/shared/supabase/client";
import { clearSignupDraft } from "~/features/auth/storage/pending-signup";
import type { ProfileFormValues } from "~/features/auth/model/types";
import { disconnectWebPushForLogout } from "~/features/notifications";

function optionalNumber(value: string): number | undefined {
  return value ? Number(value) : undefined;
}

export async function signIn(email: string, password: string): Promise<void> {
  const supabase = getSupabase();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  try {
    await disconnectWebPushForLogout();
  } catch {
    // Local unsubscribe is attempted even when the server cleanup fails.
  }
  // scope는 local이다. 기본값 global은 다른 기기와 PWA의 세션까지 끊는다.
  if (session) {
    const { error: signOutError } = await supabase.auth.signOut({
      scope: "local",
    });
    if (signOutError) throw signOutError;
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
}

/**
 * 계정 생성과 확인 코드 발송이 한 호출이라, 가입 마법사는 이메일 인증 단계 진입 시에만 부른다.
 * 앞 단계에서 부르면 코드가 입력 전에 늙는다.
 */
export async function signUp(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signUp({ email, password });
  if (error) throw error;
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

/** 비밀번호 변경 전 본인 확인 nonce를 현재 세션 계정 이메일로 보낸다. 이메일을 인자로 받지 않는 게 요점이다. */
export async function sendPasswordChangeOtp(): Promise<void> {
  const { error } = await getSupabase().auth.reauthenticate();
  if (error) throw error;
}

/**
 * 로그인 전 비밀번호 찾기. 없는 계정이어도 Supabase가 성공으로 응답한다.
 * 계정 존재 여부를 숨기려는 의도이므로 호출자도 결과를 갈라 보여주지 않는다.
 */
export async function sendPasswordResetOtp(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email);
  if (error) throw error;
}

/** 재설정 코드를 세션으로 바꾼다. 이 세션이 있어야 새 비밀번호를 설정할 수 있다. */
export async function verifyPasswordResetOtp(
  email: string,
  token: string,
): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({
    email,
    token,
    type: "recovery",
  });
  if (error) throw error;
}

/**
 * 새 비밀번호를 설정한다. 성공하면 Auth가 다른 기기의 세션을 폐기한다.
 * `nonce`는 로그인 상태 변경 때만 쓴다. 비밀번호 찾기는 recovery 세션이 본인 확인이다.
 */
export async function updatePassword(
  password: string,
  nonce?: string,
): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({ password, nonce });
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
  clearSignupDraft();
}

export async function signOut(): Promise<void> {
  try {
    await disconnectWebPushForLogout();
  } catch {
    // Signing out must remain possible when subscription cleanup is offline.
  }
  const { error } = await getSupabase().auth.signOut();

  if (error) throw error;
  clearSignupDraft();
}
