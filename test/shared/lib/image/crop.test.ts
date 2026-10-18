import { describe, expect, it } from "vitest";

import {
  clipCropRect,
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

  it("zoom이 1 미만이면 사각형이 이미지 밖까지 걸친다", () => {
    // 3:4 사진을 9:16 프레임에 전체가 들어가게 줄이고 맨 위로 붙인다.
    const base = {
      imageWidth: 900,
      imageHeight: 1200,
      frameWidth: 90,
      frameHeight: 160,
    };
    const { containZoom, maxOffsetY } = coverFit({ ...base, zoom: 0.75 });
    expect(containZoom).toBe(0.75);

    expect(
      coverCropRect({ ...base, zoom: 0.75, offsetX: 0, offsetY: -maxOffsetY }),
    ).toEqual({ x: 0, y: 0, width: 900, height: 1600 });
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
    expect(fit.containZoom).toBe(0.5);
  });

  it("프레임보다 작아진 축에서는 이미지가 프레임 안에 머무는 만큼만 움직인다", () => {
    // zoom 0.5: 표시 400×200, 프레임 200×200 → 가로는 덮는 한계, 세로는 남는 50px의 절반씩.
    const fit = coverFit({
      imageWidth: 2000,
      imageHeight: 1000,
      frameWidth: 200,
      frameHeight: 200,
      zoom: 0.5,
    });

    expect(fit.maxOffsetX).toBe(0);
    expect(fit.maxOffsetY).toBe(50);
  });
});

describe("clipCropRect", () => {
  const image = { width: 1000, height: 1000 };

  it("이미지 안의 사각형은 결과물 전체에 그대로 그린다", () => {
    expect(
      clipCropRect({ x: 100, y: 200, width: 500, height: 500 }, image, {
        width: 250,
        height: 250,
      }),
    ).toEqual({
      source: { x: 100, y: 200, width: 500, height: 500 },
      dest: { x: 0, y: 0, width: 250, height: 250 },
    });
  });

  it("이미지 밖으로 걸친 부분은 빼고, 남는 부분을 결과물의 같은 자리에 그린다", () => {
    expect(
      clipCropRect({ x: -500, y: 0, width: 2000, height: 1000 }, image, {
        width: 200,
        height: 100,
      }),
    ).toEqual({
      source: { x: 0, y: 0, width: 1000, height: 1000 },
      dest: { x: 50, y: 0, width: 100, height: 100 },
    });
  });

  it("이미지와 겹치지 않으면 그릴 것이 없다", () => {
    expect(
      clipCropRect({ x: 1000, y: 0, width: 100, height: 100 }, image, {
        width: 100,
        height: 100,
      }),
    ).toBeNull();
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

  it("aspect를 주면 소수 크롭 영역도 그 비율에 정확히 맞춘다", () => {
    // 따로 반올림하면 1201×300이 된다. 그룹 커버 DB 검사는 width = height * 4다.
    expect(fitOutputSize({ width: 1201.2, height: 300.3 }, 2400, 4)).toEqual({
      width: 1200,
      height: 300,
    });
    expect(fitOutputSize({ width: 2399.6, height: 599.9 }, 2400, 4)).toEqual({
      width: 2400,
      height: 600,
    });
    expect(fitOutputSize({ width: 5000, height: 1250.2 }, 2400, 4)).toEqual({
      width: 2400,
      height: 600,
    });
    expect(fitOutputSize({ width: 2.1, height: 0.5 }, 2400, 4)).toEqual({
      width: 4,
      height: 1,
    });
  });
});
