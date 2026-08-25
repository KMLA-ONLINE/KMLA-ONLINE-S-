import { describe, expect, it } from "vitest";

import { feedKeys } from "~/features/feed";
import { invalidateSavedProfilePost } from "~/routes/app/profile/post-cache";
import { getQueryClient } from "~/shared/lib/query-client";

describe("saved profile post cache invalidation", () => {
  it("invalidates the feed", async () => {
    const queryClient = getQueryClient();
    queryClient.setQueryData(feedKeys.page(null), { posts: [] });

    await invalidateSavedProfilePost();

    expect(queryClient.getQueryState(feedKeys.page(null))?.isInvalidated).toBe(
      true,
    );
  });
});
