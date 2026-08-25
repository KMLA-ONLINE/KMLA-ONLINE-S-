export const FEED_STALE_TIME = 15_000;

export const feedKeys = {
  all: ["feed"] as const,
  page: (pageToken: string | null) =>
    [...feedKeys.all, "page", pageToken] as const,
};
