import { beforeEach, describe, expect, it } from "vitest";

import {
  readPostViewMode,
  writePostViewMode,
} from "~/features/posts/model/view-preference";

describe("post view preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to cards and persists one versioned preference for all groups", () => {
    expect(readPostViewMode()).toBe("card");
    writePostViewMode("list");
    expect(readPostViewMode()).toBe("list");
    expect(window.localStorage.getItem("kmla-online:posts-view:v1")).toBe(
      "list",
    );
  });

  it("falls back safely when storage contains an unsupported value", () => {
    window.localStorage.setItem("kmla-online:posts-view:v1", "gallery");
    expect(readPostViewMode()).toBe("card");
  });
});
