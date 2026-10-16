import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadAuthState: vi.fn(),
  loadMySuspension: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("~/features/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAuthState: mocks.loadAuthState,
  loadMySuspension: mocks.loadMySuspension,
  signOut: mocks.signOut,
}));

vi.mock("~/features/support", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listAdminContacts: () => Promise.resolve([]),
}));

import SuspendedPage, { clientLoader } from "~/routes/auth/suspended";
import { renderRoute, screen } from "../router";

const profile = { name: "홍길동", status: "accepted" };

async function redirectOf(promise: Promise<unknown>) {
  const thrown = await promise.catch((error: unknown) => error);
  return (thrown as Response).headers.get("Location");
}

describe("suspension notice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAuthState.mockResolvedValue({
      email: "student@kmla.hs.kr",
      profile,
    });
  });

  // 정지가 끝났거나 풀렸으면 상태 확인만으로 앱에 돌아간다.
  it("returns to the app when no suspension is active", async () => {
    mocks.loadMySuspension.mockResolvedValue(null);

    await expect(redirectOf(clientLoader())).resolves.toBe("/");
  });

  it("sends a member who is not accepted to their own status screen", async () => {
    mocks.loadAuthState.mockResolvedValue({
      email: "student@kmla.hs.kr",
      profile: { ...profile, status: "pending" },
    });

    await expect(redirectOf(clientLoader())).resolves.toBe("/pending");
    expect(mocks.loadMySuspension).not.toHaveBeenCalled();
  });

  it("shows the reason and the Korea-time end", () => {
    const Suspended = SuspendedPage as ComponentType<any>;
    renderRoute(
      () => (
        <Suspended
          loaderData={{
            profile,
            suspension: {
              reason: "분탕 행위 확인",
              expires_at: "2026-10-23T12:05:00Z",
            },
            contacts: Promise.resolve([]),
          }}
        />
      ),
      { path: "/suspended" },
    );

    expect(
      screen.getByRole("heading", { name: "이용이 정지되었어요" }),
    ).toBeVisible();
    expect(screen.getByText("분탕 행위 확인")).toBeVisible();
    expect(screen.getByText(/2026년 10월 23일 21:05/)).toBeVisible();
  });

  it("shows an indefinite suspension as such", () => {
    const Suspended = SuspendedPage as ComponentType<any>;
    renderRoute(
      () => (
        <Suspended
          loaderData={{
            profile,
            suspension: { reason: "외부인 계정 확인", expires_at: null },
            contacts: Promise.resolve([]),
          }}
        />
      ),
      { path: "/suspended" },
    );

    expect(screen.getByText("무기한")).toBeVisible();
  });
});
