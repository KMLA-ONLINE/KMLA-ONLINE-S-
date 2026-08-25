import { feedKeys } from "~/features/feed";
import { groupKeys } from "~/features/groups";
import { getQueryClient } from "~/shared/lib/query-client";

export async function invalidateSavedGroupPost(groupId: string) {
  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: groupKeys.posts(groupId),
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: feedKeys.all,
      refetchType: "none",
    }),
  ]);
}
