import type { GroupPostReportReason } from "~/features/posts/model/group-report";
import { getSupabase } from "~/shared/supabase/client";
import type { Database } from "~/shared/supabase/database.types";

type Functions = Database["public"]["Functions"];

type SummaryRow =
  Functions["list_group_post_report_summaries"]["Returns"][number];

type DescriptionRow =
  Functions["list_group_post_report_descriptions"]["Returns"][number];

export type GroupPostReportSort = "count" | "recent";

export type GroupPostReportSummary = Omit<
  SummaryRow,
  "author_pub_id" | "author_name" | "author_avatar_path"
> & {
  author_pub_id: string | null;
  author_name: string | null;
  author_avatar_path: string | null;
};

export interface GroupPostReportCursor {
  reportCount: number;
  latestAt: string;
  postId: string;
}

export interface GroupPostReportSummaryPage {
  reports: GroupPostReportSummary[];
  nextCursor: GroupPostReportCursor | null;
}

export interface GroupPostReportDescriptionCursor {
  createdAt: string;
  reportId: number;
}

export interface GroupPostReportDescriptionPage {
  descriptions: DescriptionRow[];
  nextCursor: GroupPostReportDescriptionCursor | null;
}

const SUMMARY_PAGE_SIZE = 20;
const DESCRIPTION_PAGE_SIZE = 8;

export async function reportGroupPost(
  postId: string,
  reason: GroupPostReportReason,
  description: string | null,
): Promise<void> {
  const { error } = await getSupabase().rpc("report_group_post", {
    p_post_id: postId,
    p_reason: reason,
    p_description: description ?? undefined,
  });

  if (error) throw error;
}

export async function listGroupPostReportSummaries(
  groupId: string,
  sort: GroupPostReportSort,
  cursor?: GroupPostReportCursor,
): Promise<GroupPostReportSummaryPage> {
  const { data, error } = await getSupabase().rpc(
    "list_group_post_report_summaries",
    {
      p_group_id: groupId,
      p_sort: sort,
      p_cursor_report_count: cursor?.reportCount,
      p_cursor_latest_at: cursor?.latestAt,
      p_cursor_post_id: cursor?.postId,
      p_limit: SUMMARY_PAGE_SIZE + 1,
    },
  );

  if (error) throw error;

  const rows = data ?? [];
  const reports = rows.slice(0, SUMMARY_PAGE_SIZE);
  const hasMore = rows.length > SUMMARY_PAGE_SIZE;
  const last = reports.at(-1);

  return {
    reports,
    nextCursor:
      hasMore && last
        ? {
            reportCount: last.report_count,
            latestAt: last.latest_at,
            postId: last.post_id,
          }
        : null,
  };
}

export async function listGroupPostReportDescriptions(
  groupId: string,
  postId: string,
  cursor?: GroupPostReportDescriptionCursor,
): Promise<GroupPostReportDescriptionPage> {
  const { data, error } = await getSupabase().rpc(
    "list_group_post_report_descriptions",
    {
      p_group_id: groupId,
      p_post_id: postId,
      p_before_created_at: cursor?.createdAt,
      p_before_report_id: cursor?.reportId,
      p_limit: DESCRIPTION_PAGE_SIZE + 1,
    },
  );

  if (error) throw error;

  const rows = data ?? [];
  const descriptions = rows.slice(0, DESCRIPTION_PAGE_SIZE);
  const hasMore = rows.length > DESCRIPTION_PAGE_SIZE;
  const last = descriptions.at(-1);

  return {
    descriptions,
    nextCursor:
      hasMore && last
        ? {
            createdAt: last.created_at,
            reportId: last.report_id,
          }
        : null,
  };
}

export function getGroupPostReportErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error
  ) {
    const code = String(error.code);
    const message = String(error.message);

    if (code === "23505" || message.includes("already reported")) {
      return "이미 신고한 게시물입니다.";
    }

    if (message.includes("cannot report own post")) {
      return "자신의 게시물은 신고할 수 없습니다.";
    }

    if (code === "42501") {
      return "이 게시물을 신고할 수 없습니다.";
    }
  }

  return "신고를 처리하지 못했습니다.";
}
