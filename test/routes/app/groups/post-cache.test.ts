import { describe, expect, it } from "vitest";

import { feedKeys } from "~/features/feed";
import { groupKeys } from "~/features/groups";
import { invalidateSavedGroupPost } from "~/routes/app/groups/post-cache";
import { getQueryClient } from "~/shared/lib/query-client";

describe("saved group post cache invalidation", () => {
  it("invalidates the group post list and feed", async () => {
    const queryClient = getQueryClient();
    queryClient.setQueryData(groupKeys.posts("group-id", null, null), {
      posts: [],
    });
    queryClient.setQueryData(feedKeys.page(null), { posts: [] });

    await invalidateSavedGroupPost("group-id");

    expect(
      queryClient.getQueryState(groupKeys.posts("group-id", null, null))
        ?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(feedKeys.page(null))?.isInvalidated).toBe(
      true,
    );
  });
});
