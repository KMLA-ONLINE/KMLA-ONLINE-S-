import { describe, expect, it } from "vitest";

import {
  gongangScheduleSaveErrorMessage,
  reservationCancelErrorMessage,
  reservationCreateErrorMessage,
} from "~/features/school-utilities/model/reservation-error";

describe("reservationCreateErrorMessage", () => {
  it("separates a manager hold from a slot another user took first", () => {
    expect(
      reservationCreateErrorMessage(
        { code: "23505", message: "reserved by gongang manager" },
        false,
      ),
    ).toBe("공강 관리자가 미리 예약한 일정입니다.");
    expect(
      reservationCreateErrorMessage(
        { code: "23505", message: "reservation slot is already occupied" },
        false,
      ),
    ).toBe("다른 사용자가 먼저 예약했습니다.");
  });

  it("explains a recurring conflict as a long-term booking failure", () => {
    expect(
      reservationCreateErrorMessage(
        { code: "23505", message: "reservation slot is already occupied" },
        true,
      ),
    ).toBe(
      "같은 요일·시간에 이미 등록된 예약이 있어 장기 예약을 할 수 없습니다.",
    );
  });

  it("names the booking window when the date is out of range", () => {
    expect(
      reservationCreateErrorMessage(
        {
          code: "22023",
          message: "utility reservations are limited to the current Korea week",
        },
        false,
      ),
    ).toBe("오늘부터 이번 주 일요일까지만 예약할 수 있습니다.");
  });

  it("points at the connection when the request never arrived", () => {
    expect(
      reservationCreateErrorMessage({ message: "Failed to fetch" }, false),
    ).toBe("인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
  });

  it("falls back to a retry message for anything else", () => {
    expect(reservationCreateErrorMessage(new Error("boom"), false)).toBe(
      "예약하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  });
});

describe("reservationCancelErrorMessage", () => {
  it("treats a missing or foreign reservation as already gone", () => {
    expect(
      reservationCancelErrorMessage({
        code: "42501",
        message: "reservation not found",
      }),
    ).toBe("이미 취소됐거나 본인의 예약이 아닙니다.");
    expect(
      reservationCancelErrorMessage({
        code: "42501",
        message: "accepted profile required",
      }),
    ).toBe("취소할 권한이 없습니다.");
  });

  it("separates a past one-off from a bad recurring end date", () => {
    expect(
      reservationCancelErrorMessage({
        code: "22023",
        message: "past utility reservations cannot be cancelled",
      }),
    ).toBe("지난 예약은 취소할 수 없습니다.");
    expect(
      reservationCancelErrorMessage({
        code: "22023",
        message: "invalid recurring cancellation date",
      }),
    ).toBe("장기 예약은 오늘 이후 날짜부터만 종료할 수 있습니다.");
  });

  it("falls back to a retry message for anything else", () => {
    expect(reservationCancelErrorMessage(new Error("boom"))).toBe(
      "취소하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  });
});

describe("gongangScheduleSaveErrorMessage", () => {
  it.each([
    [
      { code: "42501", message: "gongang manager permission required" },
      "선예약을 관리할 권한이 없습니다.",
    ],
    [
      { code: "22023", message: "only next week can be configured" },
      "다음 주 일정만 선예약할 수 있습니다. 주가 바뀌었다면 화면을 새로고침해 주세요.",
    ],
    [
      { code: "23505", message: "manager schedule is already occupied" },
      "다른 반복 선예약과 겹칩니다. 기존 선예약을 먼저 종료해 주세요.",
    ],
    [
      { code: "23505", message: "reservation slot is already occupied" },
      "학생의 단발 예약이 있는 칸은 선예약할 수 없습니다.",
    ],
  ])("explains %o", (error, message) => {
    expect(gongangScheduleSaveErrorMessage(error)).toBe(message);
  });
});
