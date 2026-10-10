import { isNetworkError } from "~/shared/lib/network-error";

/**
 * 예약 신청 실패를 사용자가 할 수 있는 조치로 옮긴다. 코드와 문구는
 * `supabase/schemas/51-utility-reservations.sql`의 insert trigger가 던지는 값이다.
 *
 * 23505는 trigger가 두 경우에 같이 쓰므로 문구로 가른다.
 */
export function reservationCreateErrorMessage(
  error: unknown,
  recurring: boolean,
): string {
  if (isNetworkError(error)) {
    return "인터넷 연결을 확인한 뒤 다시 시도해주세요.";
  }

  const { code, message } =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : {};
  const text = typeof message === "string" ? message : "";

  if (code === "23505") {
    if (text.includes("reserved by gongang manager")) {
      return "공강 관리자가 미리 예약한 일정입니다.";
    }
    return recurring
      ? "같은 요일·시간에 이미 신청된 예약이 있어 장기 예약을 할 수 없습니다."
      : "다른 사용자가 먼저 신청했습니다.";
  }
  if (code === "22023" && text.includes("current Korea week")) {
    return "오늘부터 이번 주 일요일까지만 신청할 수 있습니다.";
  }
  if (code === "42501") return "신청할 권한이 없습니다.";
  if (code === "23514") return "입력한 내용을 다시 확인해주세요.";

  return "신청하지 못했습니다. 잠시 후 다시 시도해주세요.";
}
