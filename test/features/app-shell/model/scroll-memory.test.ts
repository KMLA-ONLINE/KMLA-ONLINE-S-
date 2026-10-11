import { describe, expect, it } from "vitest";

import { resolveScrollTarget } from "~/features/app-shell/model/scroll-memory";

const feed = { key: "feed", pathname: "/" };
const group = { key: "group", pathname: "/groups/club" };

function resolve(
  overrides: Partial<Parameters<typeof resolveScrollTarget>[0]>,
) {
  return resolveScrollTarget({
    previous: group,
    next: feed,
    navigationType: "PUSH",
    rememberByPath: false,
    byKey: new Map(),
    byPath: new Map(),
    ...overrides,
  });
}

describe("resolveScrollTarget", () => {
  it("첫 렌더에서는 건드리지 않는다", () => {
    expect(resolve({ previous: null })).toBeNull();
  });

  it("뒤로 가기는 그 기록 항목의 위치로 돌아간다", () => {
    expect(
      resolve({ navigationType: "POP", byKey: new Map([["feed", 1800]]) }),
    ).toBe(1800);
  });

  it("새 화면은 맨 위에서 시작한다", () => {
    expect(resolve({ byPath: new Map([["/", 1800]]) })).toBe(0);
  });

  it("경로로 기억하는 화면은 탭으로 다시 들어와도 마지막 위치로 돌아간다", () => {
    expect(
      resolve({ rememberByPath: true, byPath: new Map([["/", 1800]]) }),
    ).toBe(1800);
  });

  it("뒤로 가기에서는 경로 위치보다 기록 항목의 위치가 우선한다", () => {
    expect(
      resolve({
        navigationType: "POP",
        rememberByPath: true,
        byKey: new Map([["feed", 900]]),
        byPath: new Map([["/", 1800]]),
      }),
    ).toBe(900);
  });

  it("같은 경로 안의 이동과 목록 위 게시물 상세는 그대로 둔다", () => {
    expect(
      resolve({ previous: feed, next: { key: "feed-overlay", pathname: "/" } }),
    ).toBeNull();
    expect(
      resolve({
        previous: group,
        next: { key: "post", pathname: "/groups/club/posts/abc" },
      }),
    ).toBeNull();
    expect(
      resolve({
        previous: { key: "post", pathname: "/groups/club/posts/abc" },
        next: { key: "group-again", pathname: "/groups/club" },
        navigationType: "POP",
      }),
    ).toBeNull();
  });
});
