/**
 * 요청이 서버에 닿지 못해서 난 실패인지 판정한다. 오류 화면이 서버 탓 문구 대신 연결을
 * 확인하라고 안내할지를 가른다.
 *
 * 브라우저마다 fetch 실패 문구가 다르다(Chrome `Failed to fetch`, Firefox `NetworkError when
 * attempting to fetch resource.`, Safari `Load failed`). supabase-js의 PostgREST 클라이언트는
 * 이 `TypeError`를 삼키고 문구만 `message`에 담은 오류 객체를 돌려주므로 문구로 본다. Auth
 * 클라이언트는 `AuthRetryableFetchError`로 감싼다.
 */
const NETWORK_FAILURE_PATTERN =
  /failed to fetch|networkerror when attempting to fetch|load failed/i;

export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }
  if (typeof error !== "object" || error === null) return false;
  if ("name" in error && error.name === "AuthRetryableFetchError") return true;

  return (
    "message" in error &&
    typeof error.message === "string" &&
    NETWORK_FAILURE_PATTERN.test(error.message)
  );
}
