import { describe, expect, it } from "vitest";

import {
  getGroupPostReportReasonLabel,
  validateGroupPostReport,
} from "~/features/posts/model/group-report";

describe("group post report model", () => {
  it("labels reasons and validation in Korean by default", () => {
    expect(getGroupPostReportReasonLabel("spam")).toBe("스팸·광고");
    expect(validateGroupPostReport(null, "")).toBe(
      "신고 사유를 선택해 주세요.",
    );
  });

  it("labels reasons and validation in English on request", () => {
    expect(getGroupPostReportReasonLabel("spam", "en")).toBe(
      "Spam or advertising",
    );
    expect(validateGroupPostReport(null, "", "en")).toBe(
      "Select a reason for the report.",
    );
    expect(validateGroupPostReport("other", "", "en")).toBe(
      "Describe the reason when choosing Other.",
    );
  });
});
