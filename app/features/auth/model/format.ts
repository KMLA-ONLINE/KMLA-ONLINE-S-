/**
 * Supabase auth 에러를 사용자에게 보여줄 문구로 바꾼다.
 *
 * 입력은 wire(에러 코드)지만 출력은 화면이라 `data/`가 아니라 여기에 둔다. Supabase client
 * 대역 없이 그대로 테스트할 수 있다는 점이 이 경계의 실익이다.
 */
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
  if (code === "over_request_rate_limit") {
    return "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (code === "reauthentication_needed") {
    return "본인 확인이 필요합니다. 인증 코드를 다시 받아 주세요.";
  }
  if (code === "reauthentication_not_valid") {
    return "인증 코드가 올바르지 않습니다. 메일을 다시 확인해 주세요.";
  }
  if (code === "same_password") {
    return "지금 쓰고 있는 비밀번호와 다른 비밀번호를 입력해 주세요.";
  }
  if (code === "weak_password") {
    return "비밀번호가 너무 단순합니다. 다른 비밀번호를 입력해 주세요.";
  }

  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
