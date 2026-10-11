import { describe, expect, it } from "vitest";

import { resistDrag } from "~/shared/lib/drag-resistance";

describe("resistDrag", () => {
  it("follows small drags closely and keeps the direction", () => {
    expect(resistDrag(0, 72)).toBe(0);
    expect(resistDrag(10, 72)).toBeGreaterThan(9);
    expect(resistDrag(-10, 72)).toBeLessThan(-9);
  });

  it("never travels past the limit however far the finger goes", () => {
    expect(resistDrag(10_000, 72)).toBeLessThanOrEqual(72);
    expect(resistDrag(-10_000, 72)).toBeGreaterThanOrEqual(-72);
  });
});
