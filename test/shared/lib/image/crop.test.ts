import { describe, expect, it } from "vitest";

import {
  coverCropRect,
  coverFit,
  fitOutputSize,
} from "~/shared/lib/image/crop";

// 실제 크롭(canvas.drawImage/toBlob)은 jsdom에서 돌지 않으므로 브라우저 통합 테스트의 몫이다.
// 여기서는 canvas 없이 검증되는 순수 기하 — 미리보기와 크롭이 공유하는 좌표 계약 — 만 고정한다.

describe("coverCropRect", () => {
  it("정사각 이미지·정사각 프레임·기본값이면 이미지 전체를 가리킨다", () => {
    expect(
      coverCropRect({
        imageWidth: 1000,
        imageHeight: 1000,
        frameWidth: 200,
        frameHeight: 200,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
      }),
    ).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
  });

  it("가로가 넓은 이미지는 zoom 1에서 가운데 정사각을 잘라 낸다", () => {
    expect(
      coverCropRect({
        imageWidth: 2000,
        imageHeight: 1000,
        frameWidth: 200,
        frameHeight: 200,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
      }),
    ).toEqual({ x: 500, y: 0, width: 1000, height: 1000 });
  });

  it("pan은 이미지가 프레임을 계속 덮도록 대칭 한계로 갇힌다", () => {
    const base = {
      imageWidth: 2000,
      imageHeight: 1000,
      frameWidth: 200,
      frameHeight: 200,
      zoom: 1,
    };

    const clamped = coverCropRect({ ...base, offsetX: 100_000, offsetY: 0 });
    const atLimit = coverCropRect({ ...base, offsetX: 100, offsetY: 0 });

    expect(clamped).toEqual(atLimit);
    expect(clamped.x).toBe(0);
    expect(coverCropRect({ ...base, offsetX: -100_000, offsetY: 0 }).x).toBe(
      1000,
    );
  });

  it("zoom을 키우면 잘리는 소스 사각형이 작아진다", () => {
    const params = {
      imageWidth: 1000,
      imageHeight: 1000,
      frameWidth: 200,
      frameHeight: 200,
      offsetX: 0,
      offsetY: 0,
    };

    const wide = coverCropRect({ ...params, zoom: 1 });
    const tight = coverCropRect({ ...params, zoom: 2 });

    expect(tight.width).toBeLessThan(wide.width);
    expect(tight.width).toBe(500);
    expect(tight.x).toBe(250);
  });
});

describe("coverFit", () => {
  it("부족한 축을 채우는 배율을 base로 잡아 프레임을 덮는다", () => {
    const fit = coverFit({
      imageWidth: 2000,
      imageHeight: 1000,
      frameWidth: 200,
      frameHeight: 200,
      zoom: 1,
    });

    expect(fit.baseScale).toBe(0.2);
    expect(fit.maxOffsetX).toBe(100);
    expect(fit.maxOffsetY).toBe(0);
  });
});

describe("fitOutputSize", () => {
  it("긴 변이 maxEdge를 넘으면 종횡비를 유지한 채 눌러 담는다", () => {
    expect(fitOutputSize({ width: 3000, height: 1500 }, 1600)).toEqual({
      width: 1600,
      height: 800,
    });
  });

  it("소스보다 키우지 않는다", () => {
    expect(fitOutputSize({ width: 300, height: 300 }, 512)).toEqual({
      width: 300,
      height: 300,
    });
  });
});
