import { describe, expect, it } from "vitest";

import { navItems } from "~/features/app-shell/model/nav-items";
import {
  navItemForPathname,
  rememberTabLocation,
  resolveTabTarget,
  type TabMemory,
} from "~/features/app-shell/model/tab-memory";

const groups = navItems.find(({ to }) => to === "/groups")!;
const menu = navItems.find(({ to }) => to === "/menu")!;
const home = navItems.find(({ to }) => to === "/")!;

describe("navItemForPathname", () => {
  it("maps a path to the tab that owns it", () => {
    expect(navItemForPathname("/groups/x/posts/1")?.to).toBe("/groups");
    expect(navItemForPathname("/messenger/room")?.to).toBe("/messenger");
    expect(navItemForPathname("/settings/noti")?.to).toBe("/menu");
    expect(navItemForPathname("/")?.to).toBe("/");
  });

  it("owns no tab for screens outside the five tabs", () => {
    expect(navItemForPathname("/profile/abc")).toBeNull();
    expect(navItemForPathname("/support")).toBeNull();
    expect(navItemForPathname("/admin/members")).toBeNull();
  });
});

describe("rememberTabLocation", () => {
  it("keeps the last location per tab with its screen state", () => {
    const memory: TabMemory = new Map();

    rememberTabLocation(memory, {
      pathname: "/groups/x",
      search: "?tab=members",
    });
    rememberTabLocation(memory, { pathname: "/menu/meal", search: "" });

    expect(memory.get("/groups")).toBe("/groups/x?tab=members");
    expect(memory.get("/menu")).toBe("/menu/meal");
  });

  it("drops UI overlay params so viewers and sheets reopen closed", () => {
    const memory: TabMemory = new Map();

    rememberTabLocation(memory, {
      pathname: "/groups/x/posts/1",
      search: "?image=2&view=comments&reactions=1&tab=members",
    });

    expect(memory.get("/groups")).toBe("/groups/x/posts/1?tab=members");
  });

  it("ignores screens that belong to no tab", () => {
    const memory: TabMemory = new Map();

    rememberTabLocation(memory, { pathname: "/profile/abc", search: "" });

    expect(memory.size).toBe(0);
  });
});

describe("resolveTabTarget", () => {
  it("returns to the remembered screen from another tab", () => {
    const memory: TabMemory = new Map([["/groups", "/groups/x/posts/1"]]);

    expect(resolveTabTarget(groups, "/messenger", memory)).toBe(
      "/groups/x/posts/1",
    );
  });

  it("goes to the tab root when already inside that tab", () => {
    const memory: TabMemory = new Map([
      ["/groups", "/groups/x/posts/1"],
      ["/menu", "/settings/noti"],
    ]);

    expect(resolveTabTarget(groups, "/groups/x/posts/1", memory)).toBe(
      "/groups",
    );
    expect(resolveTabTarget(menu, "/settings/noti", memory)).toBe("/menu");
  });

  it("falls back to the tab root without memory", () => {
    expect(resolveTabTarget(groups, "/", new Map())).toBe("/groups");
    expect(resolveTabTarget(home, "/groups", new Map())).toBe("/");
  });
});
