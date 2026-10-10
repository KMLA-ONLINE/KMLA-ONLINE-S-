import { isNetworkError } from "~/shared/lib/network-error";

const NETWORK_MESSAGE = "인터넷 연결을 확인한 뒤 다시 시도해주세요.";

function readError(error: unknown): { code: unknown; text: string } {
  const { code, message } =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : {};
  return { code, text: typeof message === "string" ? message : "" };
}

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
  if (isNetworkError(error)) return NETWORK_MESSAGE;

  const { code, text } = readError(error);

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

/**
 * 예약 취소 실패를 옮긴다. 같은 schema 파일의 `cancel_utility_reservation`이 던지는 값이다.
 *
 * 42501과 22023이 각각 두 경우를 함께 쓰므로 문구로 가른다. 남의 예약과 이미 지워진
 * 예약은 함수가 일부러 구분하지 않는다.
 */
export function reservationCancelErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return NETWORK_MESSAGE;

  const { code, text } = readError(error);

  if (code === "42501") {
    if (text.includes("reservation not found")) {
      return "이미 취소됐거나 본인의 예약이 아닙니다.";
    }
    return "취소할 권한이 없습니다.";
  }
  if (code === "22023") {
    if (text.includes("past utility reservations")) {
      return "지난 예약은 취소할 수 없습니다.";
    }
    if (text.includes("invalid recurring cancellation date")) {
      return "장기 예약은 오늘 이후 날짜부터만 종료할 수 있습니다.";
    }
  }

  return "취소하지 못했습니다. 잠시 후 다시 시도해주세요.";
}
