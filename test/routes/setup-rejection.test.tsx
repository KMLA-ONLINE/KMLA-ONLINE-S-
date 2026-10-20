import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadAuthState: vi.fn(),
  loadMyApplicationRejection: vi.fn(),
}));

vi.mock("~/features/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAuthState: mocks.loadAuthState,
  loadMyApplicationRejection: mocks.loadMyApplicationRejection,
}));

import SetupPage, { clientLoader } from "~/routes/auth/setup";
import { renderRoute, screen } from "../router";

const profile = {
  name: "홍길동",
  type: "student",
  status: "draft",
  student_number: "260001",
  class_no: null,
  cohort: 31,
  gender: null,
  academic_track: null,
  phone_number: null,
  birthday: null,
  dorm_room: null,
};

function renderSetup(rejection: { reason: string } | null) {
  const Setup = SetupPage as ComponentType<any>;
  renderRoute(
    () => (
      <Setup
        loaderData={{
          email: "student@kmla.hs.kr",
          profile,
          rejection,
          values: {
            name: "홍길동",
            type: "student",
            studentNumber: "260001",
            classNo: "",
            cohort: "31",
            gender: "",
            academicTrack: "",
            phoneNumber: "",
            birthday: "",
            dormRoom: "",
          },
        }}
      />
    ),
    { path: "/setup" },
  );
}

describe("rejected application on profile setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the latest rejection for a returned application", async () => {
    mocks.loadAuthState.mockResolvedValue({
      email: "student@kmla.hs.kr",
      profile,
    });
    mocks.loadMyApplicationRejection.mockResolvedValue({
      reason: "기수와 학번이 맞지 않습니다.",
      rejected_at: "2026-10-20T00:00:00Z",
    });

    await expect(clientLoader()).resolves.toMatchObject({
      rejection: { reason: "기수와 학번이 맞지 않습니다." },
    });
  });

  // 가입 마법사에서 프로필 제출만 실패한 사람은 프로필 행이 없어 반려될 수 없다.
  it("does not look for a rejection before any profile exists", async () => {
    mocks.loadAuthState.mockResolvedValue({
      email: "student@kmla.hs.kr",
      profile: null,
    });

    await expect(clientLoader()).resolves.toMatchObject({ rejection: null });
    expect(mocks.loadMyApplicationRejection).not.toHaveBeenCalled();
  });

  it("shows the rejection reason above the form", () => {
    renderSetup({ reason: "기수와 학번이 맞지 않습니다." });

    expect(screen.getByText("가입 신청이 반려되었습니다")).toBeVisible();
    expect(screen.getByText("기수와 학번이 맞지 않습니다.")).toBeVisible();
  });

  it("shows no rejection notice when there is none", () => {
    renderSetup(null);

    expect(
      screen.queryByText("가입 신청이 반려되었습니다"),
    ).not.toBeInTheDocument();
  });
});
