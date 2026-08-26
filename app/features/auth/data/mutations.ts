import { getSupabase } from "~/shared/supabase/client";
import {
  clearPendingSignupEmail,
  setPendingSignupEmail,
} from "~/features/auth/storage/pending-signup";
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
  if (session) {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
  }

  const { error } = await supabase.auth.signInWithPassword({
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
  try {
    await disconnectWebPushForLogout();
  } catch {
    // Signing out must remain possible when subscription cleanup is offline.
  }
  const { error } = await getSupabase().auth.signOut();

  if (error) throw error;
  clearPendingSignupEmail();
}
