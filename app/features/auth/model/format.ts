function readErrorCode(error: unknown): string {
  return typeof error === "object" && error && "code" in error
    ? String(error.code)
    : "";
}

/** 인증을 안 끝낸 계정의 로그인 실패. 로그인 화면이 가입 화면으로 이어 주는 데 쓴다. */
export function isEmailNotConfirmedError(error: unknown): boolean {
  return readErrorCode(error) === "email_not_confirmed";
}

export const DUPLICATE_STUDENT_NUMBER_MESSAGE =
  "이미 등록된 학번입니다. 학번을 확인하고, 맞다면 관리자에게 문의해 주세요.";

/**
 * 다른 프로필이 이미 쓰는 학번으로 제출했다. 클라이언트는 다른 사람의 학번을 볼 수 없어
 * 미리 막지 못하고, `profiles_student_number_key`의 unique 위반으로만 알 수 있다.
 */
export function isDuplicateStudentNumberError(error: unknown): boolean {
  return (
    readErrorCode(error) === "23505" &&
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    String(error.message).includes("profiles_student_number_key")
  );
}

/** Supabase auth 에러를 문구로 바꾼다. 출력이 화면이라 `data/`가 아닌 여기에 두고 client 대역 없이 테스트한다. */
export function getAuthErrorMessage(error: unknown): string {
  const code = readErrorCode(error);

  if (code === "invalid_credentials") {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (code === "email_not_confirmed") {
    return "이메일 인증이 끝나지 않은 계정이에요. 같은 이메일로 다시 가입하면 인증 코드를 새로 보내 드려요.";
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
