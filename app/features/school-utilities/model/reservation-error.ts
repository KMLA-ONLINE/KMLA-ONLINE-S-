import { translate, type Locale } from "~/shared/i18n";
import { isNetworkError } from "~/shared/lib/network-error";

const NETWORK_MESSAGE = "인터넷 연결을 확인한 뒤 다시 시도해 주세요.";

function readError(error: unknown): { code: unknown; text: string } {
  const { code, message } =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : {};
  return { code, text: typeof message === "string" ? message : "" };
}

/**
 * 예약 등록 실패를 사용자가 할 수 있는 조치로 옮긴다. 코드와 문구는
 * `supabase/schemas/51-utility-reservations.sql`의 insert trigger가 던지는 값이다.
 *
 * 23505는 trigger가 두 경우에 같이 쓰므로 문구로 가른다.
 */
export function reservationCreateErrorMessage(
  error: unknown,
  recurring: boolean,
  locale: Locale = "ko",
): string {
  return translate(locale, createErrorSource(error, recurring));
}

function createErrorSource(error: unknown, recurring: boolean): string {
  if (isNetworkError(error)) return NETWORK_MESSAGE;

  const { code, text } = readError(error);

  if (code === "23505") {
    if (text.includes("reserved by gongang manager")) {
      return "공강 관리자가 미리 예약한 일정입니다.";
    }
    return recurring
      ? "같은 요일·시간에 이미 등록된 예약이 있어 장기 예약을 할 수 없습니다."
      : "다른 사용자가 먼저 예약했습니다.";
  }
  if (code === "22023" && text.includes("current Korea week")) {
    return "오늘부터 이번 주 일요일까지만 예약할 수 있습니다.";
  }
  if (code === "42501") return "예약할 권한이 없습니다.";
  if (code === "23514") return "입력한 내용을 다시 확인해 주세요.";

  return "예약하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

/**
 * 예약 취소 실패를 옮긴다. 같은 schema 파일의 `cancel_utility_reservation`이 던지는 값이다.
 *
 * 42501과 22023이 각각 두 경우를 함께 쓰므로 문구로 가른다. 남의 예약과 이미 지워진
 * 예약은 함수가 일부러 구분하지 않는다.
 */
export function reservationCancelErrorMessage(
  error: unknown,
  locale: Locale = "ko",
): string {
  return translate(locale, cancelErrorSource(error));
}

function cancelErrorSource(error: unknown): string {
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

  return "취소하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

/**
 * 선예약 저장 실패를 옮긴다. `save_gongang_schedule`과 `prepare_gongang_schedule` trigger가
 * 던지는 값이다. 23505는 겹친 상대가 다른 선예약인지 학생 예약인지 문구로 가른다.
 */
export function gongangScheduleSaveErrorMessage(
  error: unknown,
  locale: Locale = "ko",
): string {
  return translate(locale, scheduleSaveErrorSource(error));
}

function scheduleSaveErrorSource(error: unknown): string {
  if (isNetworkError(error)) return NETWORK_MESSAGE;

  const { code, text } = readError(error);

  if (code === "42501") return "선예약을 관리할 권한이 없습니다.";
  if (code === "22023" && text.includes("only next week")) {
    return "다음 주 일정만 선예약할 수 있습니다. 주가 바뀌었다면 화면을 새로고침해 주세요.";
  }
  if (code === "23505") {
    if (text.includes("manager schedule is already occupied")) {
      return "다른 반복 선예약과 겹칩니다. 기존 선예약을 먼저 종료해 주세요.";
    }
    return "학생의 단발 예약이 있는 칸은 선예약할 수 없습니다.";
  }
  if (code === "23514") return "입력한 내용을 다시 확인해 주세요.";

  return "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
