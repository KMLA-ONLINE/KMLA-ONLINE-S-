// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  isAboveSeededParent,
  seedColdStartBackStack,
} from "~/shared/lib/back-stack";

describe("cold start back stack", () => {
  it("puts the list and home under a conversation opened from a notification", () => {
    // jsdom의 창 하나가 알림으로 새로 연 창이다. 처음에는 뒤로 갈 내역이 없다.
    expect(window.history.length).toBe(1);
    window.history.replaceState(null, "", "/messenger/room-id?panel=details");

    seedColdStartBackStack();

    expect(window.history.length).toBe(3);
    expect(window.location.pathname).toBe("/messenger/room-id");
    expect(window.location.search).toBe("?panel=details");
    const state = window.history.state as { idx: number; usr: unknown };
    expect(state.idx).toBe(2);
    expect(isAboveSeededParent(state.usr)).toBe(true);

    // 이제 뒤로 갈 내역이 있으니 다시 불러도 쌓지 않는다.
    seedColdStartBackStack();
    expect(window.history.length).toBe(3);
  });
});
