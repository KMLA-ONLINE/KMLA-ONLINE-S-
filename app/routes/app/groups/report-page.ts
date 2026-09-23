import {
  listGroupPostReportDescriptions,
  listGroupPostReportSummaries,
  type GroupPostReportCursor,
  type GroupPostReportDescriptionCursor,
} from "~/features/posts/data/group-reports";
import type { Route } from "./+types/report-page";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const searchParams = new URL(request.url).searchParams;

  const groupId = searchParams.get("groupId");

  if (!groupId) {
    throw new Response("그룹을 찾을 수 없습니다.", { status: 400 });
  }

  if (searchParams.get("mode") === "descriptions") {
    const postId = searchParams.get("postId");

    if (!postId) {
      throw new Response("게시물을 찾을 수 없습니다.", { status: 400 });
    }

    const beforeCreatedAt = searchParams.get("beforeCreatedAt");
    const beforeReportId = searchParams.get("beforeReportId");

    const cursor: GroupPostReportDescriptionCursor | undefined =
      beforeCreatedAt &&
      beforeReportId &&
      Number.isSafeInteger(Number(beforeReportId))
        ? {
            createdAt: beforeCreatedAt,
            reportId: Number(beforeReportId),
          }
        : undefined;

    return listGroupPostReportDescriptions(groupId, postId, cursor);
  }

  const sort = searchParams.get("sort") === "recent" ? "recent" : "count";

  const afterCount = searchParams.get("afterCount");
  const afterLatestAt = searchParams.get("afterLatestAt");
  const afterPostId = searchParams.get("afterPostId");

  const cursor: GroupPostReportCursor | undefined =
    afterCount &&
    afterLatestAt &&
    afterPostId &&
    Number.isFinite(Number(afterCount))
      ? {
          reportCount: Number(afterCount),
          latestAt: afterLatestAt,
          postId: afterPostId,
        }
      : undefined;

  return listGroupPostReportSummaries(groupId, sort, cursor);
}
