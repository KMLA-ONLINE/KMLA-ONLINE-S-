import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reviewApplications: vi.fn(),
  rejectApplication: vi.fn(),
  setAppAdmin: vi.fn(),
  reauthenticateWithPassword: vi.fn(),
  suspendProfile: vi.fn(),
  liftSuspension: vi.fn(),
  refreshShellProfile: vi.fn(),
  shellProfileId: 1,
  recentError: new Error("recent"),
  accessError: new Error("access"),
}));

vi.mock("~/features/admin", () => ({
  AdminReauthentication: () => null,
  AppAdminsScreen: () => null,
  ApprovalsScreen: () => null,
  getAdminErrorMessage: () => "요청 실패",
  isAdminAccessError: (error: unknown) => error === mocks.accessError,
  isRecentAdminAuthError: (error: unknown) => error === mocks.recentError,
  listAdminMembers: vi.fn(),
  listApplications: vi.fn(),
  listRoster: vi.fn(),
  liftSuspension: mocks.liftSuspension,
  RosterScreen: () => null,
  suspendProfile: mocks.suspendProfile,
  reviewApplications: mocks.reviewApplications,
  rejectApplication: mocks.rejectApplication,
  setAppAdmin: mocks.setAppAdmin,
  unblockApplication: vi.fn(),
}));

vi.mock("~/features/auth", () => ({
  reauthenticateWithPassword: mocks.reauthenticateWithPassword,
}));

vi.mock("~/features/app-shell", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isShellProfile: (profileId: number) => profileId === mocks.shellProfileId,
  refreshShellProfile: mocks.refreshShellProfile,
}));

import { clientAction as appAdminAction } from "~/routes/app/admin/app-admins";
import { clientAction as approvalsAction } from "~/routes/app/admin/approvals";
import { clientAction as membersAction } from "~/routes/app/admin/members";

function postRequest(entries: Record<string, string>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return new Request("http://localhost/admin", { method: "POST", body: form });
}

async function expectRedirect(
  promise: Promise<unknown>,
  location: string,
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected redirect");
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(302);
    expect((error as Response).headers.get("Location")).toBe(location);
  }
}

describe("admin route actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns to the password gate when recent authentication expires", async () => {
    mocks.setAppAdmin.mockRejectedValueOnce(mocks.recentError);

    await expectRedirect(
      appAdminAction({
        request: postRequest({
          intent: "set-admin",
          profileId: "12",
          enabled: "false",
        }),
      } as never),
      "/admin/app-admins",
    );
  });

  // 자기 역할을 바꾼 경우에만 셸 프로필을 다시 읽는다. 다른 사람은 셸과 무관하다.
  it("refreshes the shell profile only when changing my own role", async () => {
    mocks.setAppAdmin.mockResolvedValue(undefined);
    const setAdmin = (profileId: string) =>
      appAdminAction({
        request: postRequest({
          intent: "set-admin",
          profileId,
          enabled: "false",
        }),
      } as never);

    await setAdmin("12");
    expect(mocks.refreshShellProfile).not.toHaveBeenCalled();

    await setAdmin(String(mocks.shellProfileId));
    expect(mocks.refreshShellProfile).toHaveBeenCalledOnce();
  });

  it("leaves the admin area when authorization is lost", async () => {
    mocks.reviewApplications.mockRejectedValueOnce(mocks.accessError);

    await expectRedirect(
      approvalsAction({
        request: postRequest({
          intent: "review",
          profileId: "12",
          status: "accepted",
        }),
      } as never),
      "/",
    );
  });

  // 정지와 해제는 매번 현재 비밀번호를 확인한 뒤 적용한다(§16.11).
  it("confirms the password before suspending for a period or indefinitely", async () => {
    await membersAction({
      request: postRequest({
        intent: "suspend",
        profileId: "12",
        reason: "분탕 행위 확인",
        days: "7",
        password: "pw",
      }),
    } as never);
    expect(mocks.reauthenticateWithPassword).toHaveBeenCalledWith("pw");
    expect(mocks.suspendProfile).toHaveBeenCalledWith(12, "분탕 행위 확인", 7);

    await membersAction({
      request: postRequest({
        intent: "suspend",
        profileId: "12",
        reason: "외부인 계정",
        indefinite: "on",
        days: "7",
        password: "pw",
      }),
    } as never);
    expect(mocks.suspendProfile).toHaveBeenLastCalledWith(
      12,
      "외부인 계정",
      null,
    );
  });

  it("does not suspend when the password is wrong", async () => {
    mocks.reauthenticateWithPassword.mockRejectedValueOnce(new Error("bad"));

    const result = await membersAction({
      request: postRequest({
        intent: "suspend",
        profileId: "12",
        reason: "분탕 행위 확인",
        days: "7",
        password: "wrong",
      }),
    } as never);
    expect(result).toMatchObject({ data: { error: "요청 실패" } });
    expect(mocks.suspendProfile).not.toHaveBeenCalled();
  });

  it("confirms the password before lifting a suspension", async () => {
    await membersAction({
      request: postRequest({ intent: "lift", profileId: "12", password: "pw" }),
    } as never);
    expect(mocks.reauthenticateWithPassword).toHaveBeenCalledWith("pw");
    expect(mocks.liftSuspension).toHaveBeenCalledWith(12);
  });

  it("rejects exactly one application with its reason", async () => {
    await expect(
      approvalsAction({
        request: postRequest({
          intent: "reject",
          profileId: "12",
          reason: "기수와 학번이 맞지 않습니다.",
        }),
      } as never),
    ).resolves.toMatchObject({ data: { ok: true } });
    expect(mocks.rejectApplication).toHaveBeenCalledWith(
      12,
      "기수와 학번이 맞지 않습니다.",
    );
  });

  it("does not reject several applications at once", async () => {
    const form = new FormData();
    form.set("intent", "reject");
    form.append("profileId", "12");
    form.append("profileId", "13");
    form.set("reason", "기수와 학번이 맞지 않습니다.");

    await expect(
      approvalsAction({
        request: new Request("http://localhost/admin", {
          method: "POST",
          body: form,
        }),
      } as never),
    ).resolves.toMatchObject({ init: { status: 400 } });
    expect(mocks.rejectApplication).not.toHaveBeenCalled();
  });
});
