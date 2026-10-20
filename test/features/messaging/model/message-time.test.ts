import { describe, expect, it } from "vitest";

import {
  formatMessageDay,
  formatMessageSessionStart,
  formatMessageTime,
  startsMessageDay,
} from "~/features/messaging/model/message-time";

describe("message time", () => {
  it("기기 시간대와 관계없이 한국 시각으로 표시한다", () => {
    expect(formatMessageTime("2026-08-28T06:12:00Z")).toBe("오후 3:12");
    expect(formatMessageDay("2026-08-28T15:30:00Z")).toBe(
      "2026년 8월 29일 토요일",
    );
  });

  it("한국 날짜로 오늘과 어제는 줄여 부른다", () => {
    const now = Date.parse("2026-08-29T00:30:00+09:00");
    expect(formatMessageDay("2026-08-29T00:10:00+09:00", now)).toBe("오늘");
    expect(formatMessageDay("2026-08-28T23:50:00+09:00", now)).toBe("어제");
    expect(formatMessageDay("2026-08-27T23:50:00+09:00", now)).toBe(
      "2026년 8월 27일 목요일",
    );
  });

  it("첫 메시지와 한국 날짜가 바뀌는 메시지 위에 날짜 구분선을 둔다", () => {
    const lateNight = { sentAt: "2026-08-28T23:59:00+09:00" };

    expect(startsMessageDay(undefined, lateNight)).toBe(true);
    expect(
      startsMessageDay(lateNight, { sentAt: "2026-08-28T23:59:30+09:00" }),
    ).toBe(false);
    expect(
      startsMessageDay(lateNight, { sentAt: "2026-08-29T00:01:00+09:00" }),
    ).toBe(true);
  });

  it("대화 흐름 구분선은 날짜 뒤에 흐름이 시작된 시각을 붙인다", () => {
    const now = Date.parse("2026-08-29T20:00:00+09:00");
    expect(formatMessageSessionStart("2026-08-29T15:12:00+09:00", now)).toBe(
      "오늘 오후 3:12",
    );
    expect(formatMessageSessionStart("2026-08-28T09:05:00+09:00", now)).toBe(
      "어제 오전 9:05",
    );
    expect(formatMessageSessionStart("2026-08-27T15:12:00+09:00", now)).toBe(
      "2026년 8월 27일 목요일 오후 3:12",
    );
  });
});
