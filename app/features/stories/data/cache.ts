export const STORY_STALE_TIME = 60_000;

export const storyKeys = {
  all: ["stories"] as const,
  active: () => [...storyKeys.all, "active"] as const,
};
