import { describe, expect, it } from "vitest";

import { inAppPath } from "~/shared/lib/in-app-link";

const ORIGIN = "https://kmla.online";

describe("inAppPath", () => {
  it("returns the path, query and hash of a same-origin URL", () => {
    expect(inAppPath(`${ORIGIN}/groups/band?tab=posts#top`, ORIGIN)).toBe(
      "/groups/band?tab=posts#top",
    );
    expect(inAppPath(ORIGIN, ORIGIN)).toBe("/");
  });

  it("treats other origins as outside the app", () => {
    expect(inAppPath("https://example.com/groups", ORIGIN)).toBeNull();
    expect(inAppPath("http://kmla.online/groups", ORIGIN)).toBeNull();
    expect(inAppPath("https://www.kmla.online/groups", ORIGIN)).toBeNull();
  });

  it("does not hand a protocol-relative path to the router", () => {
    expect(inAppPath(`${ORIGIN}//example.com`, ORIGIN)).toBeNull();
  });

  it("treats a URL it cannot parse as outside the app", () => {
    expect(inAppPath("not a url", ORIGIN)).toBeNull();
    expect(inAppPath("", ORIGIN)).toBeNull();
  });
});
