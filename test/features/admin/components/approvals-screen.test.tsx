import { describe, expect, it } from "vitest";

import { ApprovalsScreen } from "~/features/admin/components/approvals-screen";
import type { AdminApplication } from "~/features/admin/model/types";
import { renderRoute, screen } from "../../../router";

const application: AdminApplication = {
  birthday: "2009-04-01",
  cohort: 31,
  gender: "female",
  is_returning_student: false,
  name: "홍길동",
  profile_id: 1,
  profile_type: "student",
  student_number: "260001",
  submitted_at: "2026-08-20T00:00:00.000Z",
  total_count: 1,
};

describe("ApprovalsScreen", () => {
  it("shows only the details needed to review an application", () => {
    renderRoute(() => (
      <ApprovalsScreen
        pending={[application]}
        blocked={[]}
        pendingPage={1}
        blockedPage={1}
      />
    ));

    expect(screen.getByText("홍길동")).toBeVisible();
    expect(screen.getByText(/신청/)).toBeVisible();
    for (const label of [
      "사용자 유형",
      "재입학",
      "기수",
      "학번",
      "성별",
      "생일",
    ]) {
      expect(screen.getByText(label)).toBeVisible();
    }
    for (const label of [
      "반",
      "계열",
      "부서",
      "전화번호",
      "기숙사 방",
      "자기소개",
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });
});
