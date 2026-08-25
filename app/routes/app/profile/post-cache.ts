import { feedKeys } from "~/features/feed";
import { getQueryClient } from "~/shared/lib/query-client";

export async function invalidateSavedProfilePost() {
  await getQueryClient().invalidateQueries({
    queryKey: feedKeys.all,
    refetchType: "none",
  });
}
