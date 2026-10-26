import { describe, expect, it } from "vitest";

import { profilePostAuthorName } from "~/features/posts/model/profile-post";
import type { ProfilePost } from "~/features/posts/model/types";

describe("profilePostAuthorName", () => {
  it("names a missing author in the requested language", () => {
    const post = { author_name: null } as unknown as ProfilePost;
    expect(profilePostAuthorName(post)).toBe("알 수 없는 사용자");
    expect(profilePostAuthorName(post, "en")).toBe("Unknown user");
  });
});
