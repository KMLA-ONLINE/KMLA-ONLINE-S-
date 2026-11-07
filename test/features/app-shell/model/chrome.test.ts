import { describe, expect, it } from "vitest";

import {
  DEFAULT_APP_CHROME,
  defineAppChrome,
  resolveAppChrome,
} from "~/features/app-shell/model/chrome";

describe("app chrome", () => {
  it("uses the deepest matched route config", () => {
    const parent = defineAppChrome({
      header: "sticky",
      bottomNav: "sticky",
    });
    const child = defineAppChrome({
      header: "hide-on-scroll",
      bottomNav: "none",
      contentWidth: "2xl",
    });

    expect(resolveAppChrome([{ handle: parent }, { handle: child }])).toEqual(
      child.chrome,
    );
  });

  it("falls back when no valid route config is matched", () => {
    expect(
      resolveAppChrome([
        { handle: null },
        { handle: { chrome: { header: "invalid", bottomNav: "sticky" } } },
      ]),
    ).toEqual(DEFAULT_APP_CHROME);
  });

  it("uses the wide desktop canvas by default", () => {
    expect(
      defineAppChrome({ header: "sticky", bottomNav: "sticky" }).chrome,
    ).toEqual({
      header: "sticky",
      bottomNav: "sticky",
      contentWidth: "4xl",
      pullToRefresh: false,
      rememberScroll: false,
      scroll: "page",
      messageDock: true,
    });
  });

  it("rejects an invalid content width", () => {
    expect(
      resolveAppChrome([
        {
          handle: {
            chrome: {
              header: "sticky",
              bottomNav: "sticky",
              contentWidth: "7xl",
            },
          },
        },
      ]),
    ).toEqual(DEFAULT_APP_CHROME);
  });
});

describe("message dock chrome", () => {
  it("shows the desktop message dock unless a route opts out", () => {
    expect(
      defineAppChrome({ header: "sticky", bottomNav: "sticky" }).chrome
        .messageDock,
    ).toBe(true);
    expect(
      defineAppChrome({
        header: "sticky",
        bottomNav: "sticky",
        scroll: "route",
        messageDock: false,
      }).chrome.messageDock,
    ).toBe(false);
    expect(DEFAULT_APP_CHROME.messageDock).toBe(true);
  });

  it("rejects a handle whose messageDock is not a boolean", () => {
    const valid = defineAppChrome({ header: "sticky", bottomNav: "sticky" });
    expect(
      resolveAppChrome([
        { handle: { chrome: { ...valid.chrome, messageDock: "yes" } } },
      ]),
    ).toEqual(DEFAULT_APP_CHROME);
  });
});
