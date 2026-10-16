import { describe, expect, it, vi } from "vitest";

import { GroupPostReportDialog } from "~/features/posts/components/group/group-post-report-dialog";
import { renderRoute, screen } from "../../../../router";

describe("GroupPostReportDialog", () => {
  it("asks for a specific report reason and keeps the other reason description required", async () => {
    const { user } = renderRoute(() => (
      <GroupPostReportDialog
        postId="post-id"
        open
        onOpenChange={vi.fn()}
        onReported={vi.fn()}
      />
    ));

    expect(screen.getByRole("textbox", { name: /설명/ })).toHaveAttribute(
      "placeholder",
      "신고 사유를 구체적으로 적어 주세요.",
    );
    await user.click(screen.getByRole("radio", { name: "기타" }));
    await user.click(screen.getByRole("button", { name: "신고" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "기타 사유는 설명을 입력해 주세요.",
    );
  });
});
