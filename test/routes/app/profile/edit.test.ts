import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";

const { loadMyEditableProfile, loadProfileDepartments, updateMyProfile } =
  vi.hoisted(() => ({
    loadMyEditableProfile: vi.fn(),
    loadProfileDepartments: vi.fn(),
    updateMyProfile: vi.fn(),
  }));

vi.mock("~/features/profiles", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadMyEditableProfile,
  loadProfileDepartments,
  updateMyProfile,
}));

import { clientAction } from "~/routes/app/profile/edit";

/** 화면이 실제로 내보내는 칸. 생일은 년/월/일 세 칸으로 나간다. */
const SUBMITTED_FIELDS: Record<string, string> = {
  pubId: "hanbyeol-26",
  name: "이한별",
  description: "",
  birthdayYear: "2009",
  birthdayMonth: "03",
  birthdayDay: "01",
  phoneNumber: "",
  contactEmail: "",
  gender: "female",
  academicTrack: "international",
  department: "",
  classNo: "2",
  dormRoom: "304",
  allowTimelinePosts: "on",
};

function action(overrides: Record<string, string> = {}) {
  const body = new URLSearchParams({ ...SUBMITTED_FIELDS, ...overrides });

  return clientAction({
    request: new Request("https://example.com/profile/hanbyeol-26/edit", {
      method: "POST",
      body,
    }),
    params: { pubId: "hanbyeol-26" },
    context: new RouterContextProvider(),
    url: new URL("https://example.com/profile/hanbyeol-26/edit"),
    pattern: "/profile/:pubId/edit",
    serverAction: () => Promise.resolve(undefined),
  });
}

describe("profile edit action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMyEditableProfile.mockResolvedValue({
      pub_id: "hanbyeol-26",
      type: "student",
      cohort: 26,
    });
    updateMyProfile.mockImplementation((values: { pubId: string }) =>
      Promise.resolve(values.pubId),
    );
  });

  /**
   * 공개 ID를 바꾸면 저장 전의 주소는 이미 없는 주소다. 로더가 들고 있던 값으로 되돌아가면
   * 방금 저장한 사용자가 자기 프로필에서 404를 본다(기능 명세 §12.2).
   */
  it("moves to the address the save actually produced", async () => {
    const rejection = (await action({ pubId: "byeol" }).catch(
      (error: unknown) => error,
    )) as Response;

    expect(updateMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ pubId: "byeol" }),
    );
    expect(rejection.status).toBe(302);
    expect(rejection.headers.get("Location")).toBe("/profile/byeol");
  });

  it("rejects a malformed public id without asking the server", async () => {
    const result = await action({ pubId: "ab" });

    expect(updateMyProfile).not.toHaveBeenCalled();
    expect(result).toMatchObject({ init: { status: 400 } });
    expect(
      (result as { data: { errors?: { pubId?: string } } }).data.errors,
    ).toHaveProperty("pubId");
  });

  // 선점 여부는 서버만 안다. 그 실패는 폼 상단이 아니라 다시 입력할 칸 옆에 붙어야 한다.
  it("shows a taken public id next to its field", async () => {
    updateMyProfile.mockRejectedValue({ code: "23505" });

    const result = (await action({ pubId: "kim-admin" })) as {
      data: { errors?: { pubId?: string; form?: string } };
      init: { status: number };
    };

    expect(result.init.status).toBe(400);
    expect(result.data.errors?.pubId).toBeDefined();
    expect(result.data.errors?.form).toBeUndefined();
  });
});
