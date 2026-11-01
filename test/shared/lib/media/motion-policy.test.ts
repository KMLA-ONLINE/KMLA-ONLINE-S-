import { describe, expect, it } from "vitest";

import {
  exceedsVideoEstimate,
  motionDownloadName,
  fitMotionSize,
  motionKindOf,
} from "~/shared/lib/media/motion-policy";

describe("motionKindOf", () => {
  it.each([
    ["clip.mp4", "video/mp4", "video"],
    ["clip.MOV", "", "video"],
    ["anim.gif", "image/gif", "gif"],
    ["anim.gif", "", "gif"],
    ["voice.webm", "audio/webm", null],
    ["photo.jpg", "image/jpeg", null],
    ["doc.pdf", "application/pdf", null],
  ])("%s (%s) is %s", (name, type, kind) => {
    expect(motionKindOf({ name, type })).toBe(kind);
  });
});

describe("motionDownloadName", () => {
  it("종류와 ID로 이름을 만들고 확장자는 언제나 mp4다", () => {
    expect(motionDownloadName("video", "abc")).toBe("video-abc.mp4");
    expect(motionDownloadName("gif", "abc")).toBe("gif-abc.mp4");
  });
});

describe("exceedsVideoEstimate", () => {
  it("rejects only beyond twice the output cap", () => {
    // 2.096Mbps면 초당 262,000 byte라 100MiB는 약 400초다.
    expect(exceedsVideoEstimate(230)).toBe(false);
    expect(exceedsVideoEstimate(240)).toBe(true);
  });
});

describe("fitMotionSize", () => {
  it("shrinks the long edge and keeps even dimensions", () => {
    expect(fitMotionSize(1920, 1081, 1280)).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("does not upscale but still rounds down to even", () => {
    expect(fitMotionSize(321, 241, 720)).toEqual({ width: 320, height: 240 });
  });
});
