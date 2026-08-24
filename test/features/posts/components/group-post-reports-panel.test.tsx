import { screen, waitFor, within } from "@testing-library/react";
import type { ActionFunction } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { GroupPostReportsPanel } from "~/features/posts/components/group-post-reports-panel";
import type { GroupPostReportSummary } from "~/features/posts/data/group-reports";
import { renderRoute } from "../../../router";

function buildReport(
  overrides: Partial<GroupPostReportSummary> = {},
): GroupPostReportSummary {
  return {
    post_id: "post-id",
    title: "신고된 글",
    body_preview: "본문 미리보기",
    author_identity: "identified",
    author_pub_id: "hanbyeol-25",
    author_name: "한별",
    author_avatar_path: null,
    author_label: "한별",
    report_count: 3,
    dismissed_count: 0,
    description_count: 0,
    abuse_count: 2,
    sexual_count: 0,
    privacy_count: 0,
    impersonation_count: 0,
    spam_count: 1,
    other_count: 0,
    latest_at: "2026-08-24T00:00:00.000Z",
    ...overrides,
  };
}

function renderPanel(
  report: GroupPostReportSummary,
  {
    canModerate = true,
    action,
  }: { canModerate?: boolean; action?: ActionFunction } = {},
) {
  return renderRoute(
    () => (
      <GroupPostReportsPanel
        groupId="group-id"
        slug="group"
        initialPage={{ reports: [report], nextCursor: null }}
        canModerate={canModerate}
      />
    ),
    { action },
  );
}

describe("GroupPostReportsPanel", () => {
  it("confirms before dismissing and submits the dismiss intent", async () => {
    const action = vi.fn(async ({ request }: { request: Request }) => {
      const formData = await request.formData();
      return {
        intent: formData.get("intent"),
        postId: formData.get("postId"),
      };
    });
    const { user } = renderPanel(buildReport(), { action });

    await user.click(screen.getByRole("button", { name: "무시" }));

    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "신고를 무시할까요?" }),
    ).toBeVisible();
    expect(action).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "무시" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await expect(action.mock.results[0].value).resolves.toEqual({
      intent: "dismiss-report",
      postId: "post-id",
    });
  });

  it("keeps moderation actions out of a managers view", () => {
    renderPanel(buildReport(), { canModerate: false });

    expect(
      screen.queryByRole("button", { name: "무시" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "삭제" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "게시물 보기" })).toBeVisible();
  });

  it("counts only reports since the dismissal and notes the dismissed ones", () => {
    renderPanel(buildReport({ report_count: 1, dismissed_count: 5 }));

    expect(screen.getByText("신고 1")).toBeVisible();
    expect(screen.getByText("이전 5건 무시됨")).toBeVisible();
  });
});
