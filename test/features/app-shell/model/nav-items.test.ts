import { describe, expect, it } from "vitest";

import {
  isNavItemActive,
  navItems,
} from "~/features/app-shell/model/nav-items";

describe("app navigation items", () => {
  it("places messaging in the primary navigation order", () => {
    expect(navItems.map(({ label, to }) => ({ label, to }))).toEqual([
      { label: "홈", to: "/" },
      { label: "메시지", to: "/messenger" },
      { label: "그룹", to: "/groups" },
      { label: "알림", to: "/noti" },
      { label: "메뉴", to: "/menu" },
    ]);
  });

  it("keeps messaging active in a conversation room", () => {
    const messaging = navItems.find(({ to }) => to === "/messenger");

    expect(messaging).toBeDefined();
    expect(isNavItemActive("/messenger/room-id", messaging!)).toBe(true);
    expect(isNavItemActive("/messenger-other", messaging!)).toBe(false);
  });
});
