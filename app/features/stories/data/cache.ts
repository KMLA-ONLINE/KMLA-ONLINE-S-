export const STORY_STALE_TIME = 60_000;

export const storyKeys = {
  all: ["stories"] as const,
  today: (referenceDate: string) =>
    [...storyKeys.all, "today", referenceDate] as const,
};
