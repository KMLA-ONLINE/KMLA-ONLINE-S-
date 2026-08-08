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
});
