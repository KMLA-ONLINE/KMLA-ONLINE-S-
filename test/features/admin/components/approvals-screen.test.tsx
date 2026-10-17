import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";

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
  total_count: 2,
};
const second: AdminApplication = {
  ...application,
  name: "김철수",
  profile_id: 2,
};

function renderScreen(blocked: AdminApplication[] = []) {
  renderRoute(() => (
    <ApprovalsScreen
      pending={[application, second]}
      blocked={blocked}
      pendingPage={1}
      blockedPage={1}
    />
  ));
}

describe("ApprovalsScreen", () => {
  it("summarizes each application on one row", () => {
    renderScreen();

    expect(screen.getByText("홍길동")).toBeVisible();
    expect(
      screen.getAllByText(
        "재학생 · 31기 · 학번 260001 · 여성 · 생일 2009-04-01",
      )[0],
    ).toBeVisible();
    for (const label of ["전화번호", "기숙사 방", "자기소개"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("shows the bulk action bar only while applications are selected", async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(screen.queryByText(/명 선택됨/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "홍길동 선택" }));
    expect(screen.getByText("1명 선택됨")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "전체 선택" })).toHaveAttribute(
      "data-indeterminate",
    );

    await user.click(screen.getByText("김철수"));
    expect(screen.getByText("2명 선택됨")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "전체 선택" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "선택 해제" }));
    expect(screen.queryByText(/명 선택됨/)).not.toBeInTheDocument();
  });

  it("moves blocked users to their own tab", async () => {
    const user = userEvent.setup();
    renderScreen([{ ...application, name: "차단된 사람", profile_id: 3 }]);

    expect(screen.queryByText("차단된 사람")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /차단/ }));
    expect(screen.getByText("차단된 사람")).toBeVisible();
    expect(screen.getByRole("button", { name: "차단 해제" })).toBeVisible();
  });
});
