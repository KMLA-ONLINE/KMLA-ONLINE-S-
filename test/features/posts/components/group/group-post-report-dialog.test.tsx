import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("GroupPostReportDialog in English", () => {
  afterEach(() => window.localStorage.clear());

  it("renders the report form in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderRoute(() => (
      <GroupPostReportDialog
        postId="post-id"
        open
        onOpenChange={vi.fn()}
        onReported={vi.fn()}
      />
    ));

    expect(
      screen.getByRole("heading", { name: "Report post" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Report reason" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /Description/ }),
    ).toHaveAttribute("placeholder", "Describe the reason for the report.");
    expect(screen.getByRole("radio", { name: "Other" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
