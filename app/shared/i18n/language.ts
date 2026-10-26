/**
 * 화면 언어 선택. 테마·카드/목록 보기와 같은 기기 취향이라 `localStorage`에 살고, 계정이
 * 바뀌어도 남는다(`user-scoped-storage.ts`의 삭제 대상이 아니다).
 *
 * 기본값은 "시스템"이 아니라 한국어다. 사용자 대부분이 한국어를 쓰고, 영어는 실험실에서
 * 직접 고른 사람만 받아야 한다 — 기기 언어가 영어인 사람의 화면이 갑자기 바뀌면 안 된다.
 */

export type LanguagePreference = "system" | "ko" | "en";
export type Locale = "ko" | "en";

export const LANGUAGE_STORAGE_KEY = "kmla-online:language:v1";

const CHANGE_EVENT = "kmla-online:language-change";

function isPreference(value: unknown): value is LanguagePreference {
  return value === "system" || value === "ko" || value === "en";
}

/**
 * 구독자가 있는 동안의 읽기 캐시. `useSyncExternalStore`는 구독한 컴포넌트가 그려질 때마다
 * 스냅샷을 다시 읽는데, 피드 한 화면에 `useT()`가 수십 개라 매번 `localStorage`를 두드리면
 * 아깝다. 바뀌는 길은 `writeLanguagePreference`와 다른 탭의 `storage` 이벤트뿐이라 그 둘에서
 * 비운다. 구독자가 없으면(테스트, React 밖) 캐시도 두지 않아 저장소를 직접 바꿔도 바로 보인다.
 */
let cachedPreference: LanguagePreference | null = null;
let subscribers = 0;

function readStoredPreference(): LanguagePreference {
  if (typeof window === "undefined") return "ko";
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isPreference(stored) ? stored : "ko";
  } catch {
    return "ko";
  }
}

export function readLanguagePreference(): LanguagePreference {
  if (subscribers === 0) return readStoredPreference();
  cachedPreference ??= readStoredPreference();
  return cachedPreference;
}

export function writeLanguagePreference(preference: LanguagePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // 저장소를 못 써도 이번 세션 동안은 바뀐 언어로 그린다.
  }
  cachedPreference = null;
  // 같은 탭의 `setItem`은 `storage` 이벤트를 내지 않으므로 직접 알린다.
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** "시스템"은 기기 언어가 영어일 때만 영어다. 그 밖의 모든 언어는 한국어로 본다. */
export function resolveLocale(
  preference: LanguagePreference,
  navigatorLanguage: string | undefined,
): Locale {
  if (preference !== "system") return preference;
  return navigatorLanguage?.toLowerCase().startsWith("en") ? "en" : "ko";
}

/**
 * 지금 화면 언어. React 밖(`clientLoader`/`clientAction`, 모델 함수의 기본 인자)에서 쓴다.
 * 컴포넌트는 `useLocale()`로 구독해야 바뀔 때 다시 그려진다.
 */
export function getCurrentLocale(): Locale {
  return resolveLocale(
    readLanguagePreference(),
    typeof navigator === "undefined" ? undefined : navigator.language,
  );
}

export function subscribeLanguage(onChange: () => void): () => void {
  const handleChange = () => {
    cachedPreference = null;
    onChange();
  };
  subscribers += 1;
  window.addEventListener(CHANGE_EVENT, handleChange);
  // 다른 탭에서 바꾼 경우까지 따라간다.
  window.addEventListener("storage", handleChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handleChange);
    window.removeEventListener("storage", handleChange);
    subscribers -= 1;
    if (subscribers === 0) cachedPreference = null;
  };
}
