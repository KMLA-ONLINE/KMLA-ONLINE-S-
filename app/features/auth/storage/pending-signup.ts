/**
 * 가입 직후 OTP 확인과 프로필 작성 사이에 이메일을 들고 있는 자리.
 *
 * `sessionStorage`를 다루는 browser persistence adapter다. 탭을 닫으면 사라지는 게 의도된
 * 동작이다 — 가입을 중단한 이메일이 다음 방문까지 남아 있을 이유가 없다.
 */
const PENDING_SIGNUP_EMAIL_KEY = "kmla-online:pending-signup-email:v1";

export function getPendingSignupEmail(): string {
  return sessionStorage.getItem(PENDING_SIGNUP_EMAIL_KEY) ?? "";
}

export function setPendingSignupEmail(email: string): void {
  sessionStorage.setItem(PENDING_SIGNUP_EMAIL_KEY, email);
}

export function clearPendingSignupEmail(): void {
  sessionStorage.removeItem(PENDING_SIGNUP_EMAIL_KEY);
}
