import { describe, expect, it } from "vitest";

import { shouldRevalidate } from "~/routes/messenger/room";

function args(currentRoomId: string, nextRoomId: string) {
  return {
    currentParams: { roomId: currentRoomId },
    nextParams: { roomId: nextRoomId },
    defaultShouldRevalidate: true,
  } as unknown as Parameters<typeof shouldRevalidate>[0];
}

describe("messenger room revalidation", () => {
  it("같은 대화방에서 쿼리만 바뀌면(사진 뷰어 등) loader를 다시 돌리지 않는다", () => {
    expect(shouldRevalidate(args("room", "room"))).toBe(false);
  });

  it("다른 대화방으로 가면 기본 규칙을 따른다", () => {
    expect(shouldRevalidate(args("room", "other"))).toBe(true);
  });
});
