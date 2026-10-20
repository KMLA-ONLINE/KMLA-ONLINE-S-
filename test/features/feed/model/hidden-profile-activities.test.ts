import { describe, expect, it } from "vitest";

import {
  activeHiddenProfileActivities,
  hideProfileActivity,
  parseHiddenProfileActivities,
  unhideProfileActivity,
} from "~/features/feed/model/hidden-profile-activities";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-20T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("hidden profile activities", () => {
  it("keeps a hidden activity for 24 hours, then shows it again", () => {
    const entries = hideProfileActivity([], POST_ID, NOW);

    expect(entries).toEqual([{ postId: POST_ID, hiddenUntil: NOW + DAY }]);
    expect(activeHiddenProfileActivities(entries, NOW + DAY - 1)).toEqual(
      entries,
    );
    expect(activeHiddenProfileActivities(entries, NOW + DAY)).toEqual([]);
  });

  it("renews a single entry instead of creating duplicates", () => {
    const initial = hideProfileActivity([], POST_ID, NOW);
    const renewed = hideProfileActivity(initial, POST_ID, NOW + 1000);

    expect(renewed).toEqual([
      { postId: POST_ID, hiddenUntil: NOW + DAY + 1000 },
    ]);
    expect(unhideProfileActivity(renewed, POST_ID)).toEqual([]);
  });

  it("drops expired or malformed saved entries", () => {
    const active = hideProfileActivity([], POST_ID, NOW);
    expect(
      parseHiddenProfileActivities(
        JSON.stringify([
          ...active,
          { postId: "bad-id", hiddenUntil: NOW + DAY },
          { postId: POST_ID, hiddenUntil: NOW - 1 },
        ]),
        NOW,
      ),
    ).toEqual(active);
    expect(parseHiddenProfileActivities("broken", NOW)).toEqual([]);
  });

  it("does not show an activity early when more than 100 cards are hidden", () => {
    let entries = hideProfileActivity([], POST_ID, NOW);
    for (let index = 1; index <= 100; index += 1) {
      entries = hideProfileActivity(
        entries,
        `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
        NOW,
      );
    }
    expect(entries).toHaveLength(101);
    expect(entries.some((entry) => entry.postId === POST_ID)).toBe(true);
  });
});
