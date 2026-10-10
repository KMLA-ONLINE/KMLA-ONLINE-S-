import { describe, expect, it } from "vitest";

import { reservationCreateErrorMessage } from "~/features/school-utilities/model/reservation-error";

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
    ).toBe("다른 사용자가 먼저 신청했습니다.");
  });

  it("explains a recurring conflict as a long-term booking failure", () => {
    expect(
      reservationCreateErrorMessage(
        { code: "23505", message: "reservation slot is already occupied" },
        true,
      ),
    ).toBe(
      "같은 요일·시간에 이미 신청된 예약이 있어 장기 예약을 할 수 없습니다.",
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
    ).toBe("오늘부터 이번 주 일요일까지만 신청할 수 있습니다.");
  });

  it("points at the connection when the request never arrived", () => {
    expect(
      reservationCreateErrorMessage({ message: "Failed to fetch" }, false),
    ).toBe("인터넷 연결을 확인한 뒤 다시 시도해주세요.");
  });

  it("falls back to a retry message for anything else", () => {
    expect(reservationCreateErrorMessage(new Error("boom"), false)).toBe(
      "신청하지 못했습니다. 잠시 후 다시 시도해주세요.",
    );
  });
});
