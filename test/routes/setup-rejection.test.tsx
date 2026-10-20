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

  // 반려 조회는 인증 상태와 병렬로 나가지만, 프로필 행이 없으면 반려될 수 없으므로 결과를 버린다.
  it("has no rejection before any profile exists", async () => {
    mocks.loadAuthState.mockResolvedValue({
      email: "student@kmla.hs.kr",
      profile: null,
    });
    mocks.loadMyApplicationRejection.mockResolvedValue(null);

    await expect(clientLoader()).resolves.toMatchObject({ rejection: null });
  });

  // 반려 안내는 부가 정보다. 조회가 실패해도 다시 제출할 양식은 열려야 한다.
  it("still opens the form when the rejection cannot be loaded", async () => {
    mocks.loadAuthState.mockResolvedValue({
      email: "student@kmla.hs.kr",
      profile,
    });
    mocks.loadMyApplicationRejection.mockRejectedValue(new Error("network"));

    await expect(clientLoader()).resolves.toMatchObject({
      rejection: null,
      values: { name: "홍길동" },
    });
  });

  it("asks for the rejection without waiting for the auth state", async () => {
    let resolveAuth: ((value: unknown) => void) | undefined;
    mocks.loadAuthState.mockReturnValue(
      new Promise((resolve) => (resolveAuth = resolve)),
    );
    mocks.loadMyApplicationRejection.mockResolvedValue(null);

    const loading = clientLoader();
    expect(mocks.loadMyApplicationRejection).toHaveBeenCalled();
    resolveAuth?.({ email: "student@kmla.hs.kr", profile });
    await loading;
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
