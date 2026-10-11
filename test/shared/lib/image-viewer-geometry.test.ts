import { describe, expect, it } from "vitest";

import {
  IDENTITY,
  clampZoom,
  fitSize,
  frameContains,
  pinchZoom,
  rubberBandZoom,
  zoomAt,
  type FrameLayout,
} from "~/shared/lib/image-viewer-geometry";

// 400×600 뷰포트 가운데에 300×400 이미지가 놓여 있다.
const layout: FrameLayout = {
  viewport: { width: 400, height: 600 },
  center: { x: 200, y: 300 },
  frame: { width: 300, height: 400 },
};

describe("fitSize", () => {
  it("shrinks to fit while keeping the aspect ratio", () => {
    expect(
      fitSize({ width: 3000, height: 2000 }, { width: 600, height: 600 }),
    ).toEqual({ width: 600, height: 400 });
  });

  it("does not enlarge past the natural size unless allowed", () => {
    const small = { width: 200, height: 100 };
    const box = { width: 800, height: 800 };
    expect(fitSize(small, box)).toEqual(small);
    expect(fitSize(small, box, Infinity)).toEqual({ width: 800, height: 400 });
  });

  it("returns an empty size for unknown dimensions", () => {
    expect(fitSize({ width: 0, height: 0 }, { width: 10, height: 10 })).toEqual(
      { width: 0, height: 0 },
    );
  });
});

describe("clampZoom", () => {
  it("snaps back to the identity at 1x", () => {
    expect(clampZoom({ scale: 0.6, x: 40, y: -20 }, layout)).toEqual(IDENTITY);
  });

  it("stops panning where an empty edge would show", () => {
    // 2배면 600×800이다. 가로로 100px, 세로로 100px씩만 여유가 있다.
    expect(clampZoom({ scale: 2, x: 500, y: -500 }, layout)).toEqual({
      scale: 2,
      x: 100,
      y: -100,
    });
  });

  it("caps the scale at 5x", () => {
    expect(clampZoom({ scale: 9, x: 0, y: 0 }, layout).scale).toBe(5);
  });

  it("keeps an axis that still fits centred on the stage", () => {
    const wide: FrameLayout = { ...layout, frame: { width: 300, height: 100 } };
    // 2배여도 세로 200px은 600px 안에 들어간다.
    expect(clampZoom({ scale: 2, x: 0, y: 80 }, wide).y).toBe(0);
  });

  it("shifts a fitting axis only as far as needed when the stage is off-centre", () => {
    // 이미지를 놓는 자리가 위로 치우쳐 있으면, 확대해 뷰포트 위로 넘치는 만큼만 내린다.
    const offCentre: FrameLayout = { ...layout, center: { x: 200, y: 250 } };
    expect(clampZoom({ scale: 1.4, x: 0, y: 0 }, offCentre).y).toBeCloseTo(30);
  });
});

describe("zoomAt", () => {
  it("keeps the image point under the cursor in place", () => {
    const zoomed = zoomAt(IDENTITY, 2, { x: 100, y: 200 }, layout);
    expect(zoomed).toEqual({ scale: 2, x: 100, y: 100 });
    // 확대 전 (100, 200)에 있던 이미지 지점은 확대 후에도 (100, 200)이다.
    const local = { x: (100 - 200) / 1, y: (200 - 300) / 1 };
    expect(200 + zoomed.x + local.x * 2).toBe(100);
    expect(300 + zoomed.y + local.y * 2).toBe(200);
  });
});

describe("pinchZoom", () => {
  it("scales by the finger distance and follows the midpoint", () => {
    expect(
      pinchZoom(
        IDENTITY,
        { x: 200, y: 300 },
        100,
        { x: 230, y: 300 },
        300,
        layout,
      ),
    ).toEqual({ scale: 3, x: 30, y: 0 });
  });
});

describe("rubberBandZoom", () => {
  it("resists instead of stopping past the limits", () => {
    const stretched = rubberBandZoom({ scale: 2, x: 200, y: 0 }, layout);
    expect(stretched.x).toBeGreaterThan(100);
    expect(stretched.x).toBeLessThan(200);
  });
});

describe("frameContains", () => {
  it("tells the image from the backdrop", () => {
    expect(frameContains(layout, IDENTITY, { x: 200, y: 300 })).toBe(true);
    expect(frameContains(layout, IDENTITY, { x: 20, y: 20 })).toBe(false);
    expect(
      frameContains(layout, { scale: 2, x: 0, y: 0 }, { x: 20, y: 20 }),
    ).toBe(true);
  });
});
