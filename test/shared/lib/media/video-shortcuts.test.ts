import { describe, expect, it } from "vitest";

import {
  formatPlaybackTime,
  videoShortcutFor,
} from "~/shared/lib/media/video-shortcuts";

describe("videoShortcutFor", () => {
  it("좌우 화살표는 5초, J와 L은 10초 옮긴다", () => {
    expect(videoShortcutFor("ArrowLeft")).toEqual({
      type: "seek",
      seconds: -5,
    });
    expect(videoShortcutFor("ArrowRight")).toEqual({
      type: "seek",
      seconds: 5,
    });
    expect(videoShortcutFor("KeyJ")).toEqual({ type: "seek", seconds: -10 });
    expect(videoShortcutFor("KeyL")).toEqual({ type: "seek", seconds: 10 });
  });

  it("숫자는 전체 길이의 비율로 옮긴다", () => {
    expect(videoShortcutFor("Digit0")).toEqual({
      type: "seek-percent",
      percent: 0,
    });
    expect(videoShortcutFor("Numpad7")).toEqual({
      type: "seek-percent",
      percent: 70,
    });
  });

  it("단축키가 아니면 null이다", () => {
    expect(videoShortcutFor("KeyZ")).toBeNull();
  });
});

describe("formatPlaybackTime", () => {
  it("한 시간이 넘으면 시를 붙인다", () => {
    expect(formatPlaybackTime(65)).toBe("1:05");
    expect(formatPlaybackTime(3725)).toBe("1:02:05");
    expect(formatPlaybackTime(Number.NaN)).toBe("0:00");
  });
});
