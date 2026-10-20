import { describe, expect, it } from "vitest";

import {
  HIDDEN_PROFILE_ACTIVITY_LIMIT,
  hideProfileActivity,
  parseHiddenProfileActivities,
  unhideProfileActivity,
} from "~/features/feed/model/hidden-profile-activities";

const POST_ID = "11111111-1111-4111-8111-111111111111";

function postId(index: number) {
  return `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
}

describe("hidden profile activities", () => {
  it("keeps the most recently hidden activity first without duplicates", () => {
    const entries = hideProfileActivity(
      hideProfileActivity([POST_ID], postId(1)),
      POST_ID,
    );

    expect(entries).toEqual([POST_ID, postId(1)]);
    expect(unhideProfileActivity(entries, POST_ID)).toEqual([postId(1)]);
  });

  it("shows the oldest hidden activity again once the limit is exceeded", () => {
    let entries = hideProfileActivity([], POST_ID);
    for (let index = 1; index <= HIDDEN_PROFILE_ACTIVITY_LIMIT; index += 1) {
      entries = hideProfileActivity(entries, postId(index));
    }

    expect(HIDDEN_PROFILE_ACTIVITY_LIMIT).toBe(200);
    expect(entries).toHaveLength(200);
    expect(entries).not.toContain(POST_ID);
    expect(entries[0]).toBe(postId(200));
  });

  it("drops malformed saved entries", () => {
    expect(
      parseHiddenProfileActivities(
        JSON.stringify([POST_ID, "bad-id", 3, POST_ID]),
      ),
    ).toEqual([POST_ID]);
    expect(parseHiddenProfileActivities("broken")).toEqual([]);
    expect(parseHiddenProfileActivities('{"a":1}')).toEqual([]);
  });
});
