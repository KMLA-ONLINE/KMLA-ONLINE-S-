import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reviewApplications: vi.fn(),
  setAppAdmin: vi.fn(),
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
  reauthenticateWithPassword: vi.fn(),
  reviewApplications: mocks.reviewApplications,
  setAppAdmin: mocks.setAppAdmin,
  unblockApplication: vi.fn(),
}));

vi.mock("~/features/app-shell", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isShellProfile: (profileId: number) => profileId === mocks.shellProfileId,
  refreshShellProfile: mocks.refreshShellProfile,
}));

import { clientAction as appAdminAction } from "~/routes/app/admin/app-admins";
import { clientAction as approvalsAction } from "~/routes/app/admin/approvals";

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
});
