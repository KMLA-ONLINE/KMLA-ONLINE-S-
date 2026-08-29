import { beforeEach, describe, expect, it } from "vitest";

import {
  addRecentSearchEntry,
  readRecentSearchEntries,
  RECENT_SEARCH_STORAGE_KEY,
} from "~/features/search/model/recent-searches";

describe("recent search entries", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores the newest entry first", () => {
    addRecentSearchEntry({
      kind: "profile",
      id: "person-1",
      name: "김민준",
      avatarPath: null,
    });
    addRecentSearchEntry({
      kind: "group",
      id: "group-1",
      name: "화학 스터디",
      avatarPath: "icon/1",
    });

    const entries = readRecentSearchEntries();
    expect(entries.map((entry) => entry.id)).toEqual(["group-1", "person-1"]);
  });

  it("moves a re-clicked entry to the front instead of duplicating it", () => {
    addRecentSearchEntry({
      kind: "profile",
      id: "person-1",
      name: "김민준",
      avatarPath: null,
    });
    addRecentSearchEntry({
      kind: "group",
      id: "group-1",
      name: "화학 스터디",
      avatarPath: null,
    });
    addRecentSearchEntry({
      kind: "profile",
      id: "person-1",
      name: "김민준",
      avatarPath: null,
    });

    const entries = readRecentSearchEntries();
    expect(entries.map((entry) => entry.id)).toEqual(["person-1", "group-1"]);
  });

  it("caps the list at 10 entries", () => {
    for (let index = 0; index < 12; index += 1) {
      addRecentSearchEntry({
        kind: "profile",
        id: `person-${index}`,
        name: `사람${index}`,
        avatarPath: null,
      });
    }

    expect(readRecentSearchEntries()).toHaveLength(10);
  });

  it("falls back to an empty list when storage is corrupted", () => {
    window.localStorage.setItem(RECENT_SEARCH_STORAGE_KEY, "not json");
    expect(readRecentSearchEntries()).toEqual([]);
  });
});
