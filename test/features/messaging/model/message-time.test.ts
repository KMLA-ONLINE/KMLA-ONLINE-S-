import { describe, expect, it } from "vitest";

import {
  formatMessageDay,
  formatMessageTime,
  isSameMessageMinute,
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

  it("같은 날 같은 분일 때만 같은 표시 시각으로 본다", () => {
    expect(
      isSameMessageMinute(
        "2026-08-28T15:12:00+09:00",
        "2026-08-28T15:12:59+09:00",
      ),
    ).toBe(true);
    expect(
      isSameMessageMinute(
        "2026-08-28T15:12:00+09:00",
        "2026-08-29T15:12:00+09:00",
      ),
    ).toBe(false);
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
});
