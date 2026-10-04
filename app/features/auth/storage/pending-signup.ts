import type { ProfileFormValues } from "~/features/auth/model/types";

/**
 * 이메일 인증 전까지 가입 입력값을 들고 있는 `sessionStorage` adapter. 탭을 닫으면 사라지는 게 의도다.
 * 비밀번호는 담지 않는다 — 이 시점엔 계정이 있고 남은 단계가 비밀번호를 쓰지 않는다.
 * 메일 앱을 다녀오며 리로드돼도 인증 단계로 복귀시키는 게 목적이다.
 */
const SIGNUP_DRAFT_KEY = "kmla-online:pending-signup:v2";

export interface SignupDraft {
  email: string;
  values: ProfileFormValues;
}

export function getSignupDraft(): SignupDraft | null {
  const stored = sessionStorage.getItem(SIGNUP_DRAFT_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as SignupDraft;
    if (!parsed?.email || !parsed.values) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSignupDraft(draft: SignupDraft): void {
  sessionStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify(draft));
}

export function clearSignupDraft(): void {
  sessionStorage.removeItem(SIGNUP_DRAFT_KEY);
}
