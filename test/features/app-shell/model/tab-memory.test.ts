import { describe, expect, it } from "vitest";

import {
  isTabReturnState,
  TAB_RETURN_STATE,
  tabLocationEntry,
} from "~/features/app-shell/model/tab-memory";

describe("tabLocationEntry", () => {
  it("remembers the screen under the tab it belongs to", () => {
    expect(tabLocationEntry("/messenger/room-1", "")).toEqual({
      tab: "/messenger",
      href: "/messenger/room-1",
    });
    expect(tabLocationEntry("/groups/club/posts/abc", "?tab=posts")).toEqual({
      tab: "/groups",
      href: "/groups/club/posts/abc?tab=posts",
    });
    expect(tabLocationEntry("/settings/noti", "")).toEqual({
      tab: "/menu",
      href: "/settings/noti",
    });
  });

  it("drops overlay UI from the remembered URL", () => {
    expect(tabLocationEntry("/groups/club", "?image=1&tab=members")).toEqual({
      tab: "/groups",
      href: "/groups/club?tab=members",
    });
  });

  it("skips screens outside the tabs", () => {
    expect(tabLocationEntry("/profile/someone", "")).toBeNull();
    expect(tabLocationEntry("/admin", "")).toBeNull();
  });
});

describe("isTabReturnState", () => {
  it("recognizes only the tab return marker", () => {
    expect(isTabReturnState(TAB_RETURN_STATE)).toBe(true);
    expect(isTabReturnState(null)).toBe(false);
    expect(isTabReturnState({ from: "/" })).toBe(false);
  });
});
