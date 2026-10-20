import { screen, waitFor } from "@testing-library/react";
import { useRevalidator } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { GroupPostReportDescriptions } from "~/features/posts/components/group/group-post-report-descriptions";
import { renderRoute } from "../../../../router";

describe("GroupPostReportDescriptions", () => {
  it("keeps one explanation after the report page revalidates", async () => {
    const pageLoader = vi.fn(() =>
      Promise.resolve({
        descriptions: [
          {
            report_id: 7,
            reason: "other" as const,
            description: "국제반 차별",
            created_at: "2026-10-19T06:11:34Z",
          },
        ],
        nextCursor: null,
      }),
    );

    function Report() {
      const revalidator = useRevalidator();

      return (
        <>
          <button
            type="button"
            onClick={() => {
              void revalidator.revalidate();
            }}
          >
            화면 재검증
          </button>
          <GroupPostReportDescriptions
            groupId="group-id"
            postId="post-id"
            count={1}
          />
        </>
      );
    }

    const { user } = renderRoute(Report, {
      path: "/groups/test",
      routes: [{ path: "/groups/report-page", loader: pageLoader }],
    });

    await user.click(screen.getByRole("button", { name: "설명 1" }));
    await screen.findByText("국제반 차별");

    await user.click(screen.getByRole("button", { name: "화면 재검증" }));
    await waitFor(() => expect(pageLoader).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("국제반 차별")).toHaveLength(1);
  });
});
