import { getSupabase } from "~/shared/supabase/client";
import { clearSignupDraft } from "~/features/auth/storage/pending-signup";
import type { ProfileFormValues } from "~/features/auth/model/types";
import {
  disconnectWebPushForLogout,
  unsubscribeWebPushLocally,
} from "~/features/notifications";

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

/**
 * 인증을 마친 사람이 고른 비밀번호로 계정을 확정한다.
 *
 * 인증 전 계정에 같은 이메일로 다시 `signUp`하면 Auth는 코드만 다시 보내고 비밀번호는
 * 처음 값을 유지한다. 그대로 두면 다시 가입한 사람은 방금 정한 비밀번호로 로그인하지 못하고,
 * 남이 먼저 만들어 둔 계정이라면 그 사람의 비밀번호가 살아남는다. 처음과 같은 비밀번호면
 * Auth가 `same_password`로 거절하는데, 원하던 상태라 성공으로 친다.
 */
export async function claimSignupPassword(password: string): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({ password });
  if (error && error.code !== "same_password") throw error;
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

/**
 * 현재 계정 이메일로 비밀번호 로그인을 다시 해 JWT의 최근 인증 시각을 새로 만든다. 서버의
 * `private.require_recent_password_auth()`가 이 시각을 본다. 이메일을 인자로 받지 않는 게 요점이다.
 */
export async function reauthenticateWithPassword(
  password: string,
): Promise<void> {
  const supabase = getSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user?.email) throw new Error("Current account has no email");

  const { error } = await supabase.auth.signInWithPassword({
    email: userData.user.email,
    password,
  });
  if (error) throw error;
}

/**
 * 계정 탈퇴. 다시 인증한 뒤 탈퇴하고 이 기기의 세션을 정리한다. RPC가 커밋된 뒤에는 계정이 이미
 * 없어 서버를 부르는 `signOut()`은 실패할 뿐이므로 이 기기만 정리하고, 정리 실패를 탈퇴 실패로
 * 알리지 않는다. 기기 알림 구독 행은 RPC가 지웠다. 남은 세션은 서버가 거절하고 게이트가 비운다.
 */
export async function withdrawAccount(password: string): Promise<void> {
  await reauthenticateWithPassword(password);

  const supabase = getSupabase();
  const { error } = await supabase.rpc("withdraw_account");
  if (error) throw error;

  clearSignupDraft();
  await Promise.allSettled([
    unsubscribeWebPushLocally(),
    supabase.auth.signOut({ scope: "local" }),
  ]);
}
