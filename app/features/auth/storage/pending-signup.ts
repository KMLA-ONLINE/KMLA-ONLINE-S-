import type { ProfileFormValues } from "~/features/auth/model/types";

/**
 * 계정이 만들어진 뒤 이메일 인증이 끝나기 전까지 가입 입력값을 들고 있는 자리.
 *
 * `sessionStorage`를 다루는 browser persistence adapter다. 탭을 닫으면 사라지는 게 의도된
 * 동작이다 — 가입을 중단한 입력값이 다음 방문까지 남아 있을 이유가 없다.
 *
 * 비밀번호는 절대 담지 않는다. 이 초안이 필요한 시점에는 계정이 이미 만들어져 있어서
 * 남은 일은 인증 코드 확인과 프로필 제출뿐이고, 그 둘 중 어느 것도 비밀번호를 쓰지 않는다.
 * 모바일에서 메일 앱을 다녀오며 페이지가 다시 로드돼도 인증 단계로 돌아오게 하는 게 목적이다.
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
