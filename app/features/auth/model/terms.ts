import type { AuthProfile } from "~/features/auth/model/types";

/**
 * 시행 중인 이용약관의 판. `docs/legal/terms_of_service.md`의 시행일이며, DB의
 * `private.current_terms_version()`과 같아야 프로필 제출과 동의 기록이 통과한다. 개정 절차는
 * `docs/LEGAL_DOCUMENTS.md`가 정한다.
 */
export const TERMS_VERSION = "2026-10-20";

/**
 * 이용약관과 개인정보 처리방침이 처음 시행된 날. 기존 회원 안내는 이 사건을 알리므로 약관을
 * 개정해도 바꾸지 않는다. 그 안내를 보는 사람은 이날 전에 가입한 회원뿐이다.
 */
export const TERMS_FIRST_EFFECTIVE_DATE = "2026-10-20";

/** `YYYY-MM-DD`를 법률 문서의 표기("2026년 10월 20일")로 쓴다. */
export function formatTermsDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

/** 약관 동의 체크박스의 이름. 값은 동의한 판(`TERMS_VERSION`)이다. */
export const TERMS_FIELD = "terms";

export function readTermsAgreement(formData: FormData): boolean {
  return formData.get(TERMS_FIELD) === TERMS_VERSION;
}

/**
 * 시행 전에 가입해 동의 기록이 없는 회원만 동의를 받는다. 개정 때는 다시 묻지 않고 공지로
 * 갈음하므로 판이 오래됐는지는 보지 않는다.
 */
export function needsTermsAgreement(
  profile: Pick<AuthProfile, "terms_agreed_at"> | null,
): boolean {
  return profile !== null && profile.terms_agreed_at === null;
}
