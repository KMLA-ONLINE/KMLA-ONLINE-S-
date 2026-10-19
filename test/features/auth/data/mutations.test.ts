import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  disconnectWebPushForLogout,
  getSession,
  getSupabase,
  getUser,
  rpc,
  signInWithPassword,
  signOut,
  unsubscribeWebPushLocally,
  updateUser,
} = vi.hoisted(() => ({
  disconnectWebPushForLogout: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  getSupabase: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  unsubscribeWebPushLocally: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({ getSupabase }));
vi.mock("~/features/notifications", () => ({
  disconnectWebPushForLogout,
  unsubscribeWebPushLocally,
}));
vi.mock("~/features/auth/storage/pending-signup", () => ({
  clearSignupDraft: vi.fn(),
}));

import {
  claimSignupPassword,
  reauthenticateWithPassword,
  signIn,
  withdrawAccount,
} from "~/features/auth/data/mutations";

describe("auth mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabase.mockReturnValue({
      rpc,
      auth: { getSession, getUser, signInWithPassword, signOut, updateUser },
    });
    getUser.mockResolvedValue({
      data: { user: { email: "student@kmla.hs.kr" } },
      error: null,
    });
    rpc.mockResolvedValue({ data: null, error: null });
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    disconnectWebPushForLogout.mockResolvedValue(undefined);
    unsubscribeWebPushLocally.mockResolvedValue(undefined);
    signInWithPassword.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });
  });

  it("disconnects a stale browser subscription before signing in after session expiry", async () => {
    await signIn("next@kmla.hs.kr", "password");

    expect(disconnectWebPushForLogout).toHaveBeenCalledOnce();
    expect(signOut).not.toHaveBeenCalled();
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "next@kmla.hs.kr",
      password: "password",
    });
    expect(disconnectWebPushForLogout.mock.invocationCallOrder[0]).toBeLessThan(
      signInWithPassword.mock.invocationCallOrder[0],
    );
  });

  it("keeps stale subscription cleanup best-effort when the browser is offline", async () => {
    disconnectWebPushForLogout.mockRejectedValue(new Error("offline"));

    await expect(
      signIn("next@kmla.hs.kr", "password"),
    ).resolves.toBeUndefined();
    expect(signInWithPassword).toHaveBeenCalledOnce();
  });

  it("disconnects and signs out a valid previous session before changing accounts", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { id: "old" } } },
      error: null,
    });

    await signIn("next@kmla.hs.kr", "password");

    expect(disconnectWebPushForLogout.mock.invocationCallOrder[0]).toBeLessThan(
      signOut.mock.invocationCallOrder[0],
    );
    expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(
      signInWithPassword.mock.invocationCallOrder[0],
    );
  });

  // 기본값 global은 계정의 refresh token을 전부 폐기해 다른 기기와 설치된 PWA까지
  // 로그아웃시킨다. 정리 대상은 이 브라우저에 남은 세션뿐이다.
  it("leaves other devices signed in when clearing the previous session", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { id: "old" } } },
      error: null,
    });

    await signIn("next@kmla.hs.kr", "password");

    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  // 다시 가입하며 처음과 같은 비밀번호를 고른 경우다. 계정은 이미 원하던 상태다.
  it("treats an unchanged signup password as claimed", async () => {
    updateUser.mockResolvedValue({ error: { code: "same_password" } });

    await expect(claimSignupPassword("password123")).resolves.toBeUndefined();
    expect(updateUser).toHaveBeenCalledWith({ password: "password123" });
  });

  it("surfaces other failures while claiming the signup password", async () => {
    updateUser.mockResolvedValue({ error: { code: "weak_password" } });

    await expect(claimSignupPassword("password123")).rejects.toMatchObject({
      code: "weak_password",
    });
  });

  it("reauthenticates the current account without accepting a caller email", async () => {
    await reauthenticateWithPassword("current-password");

    expect(getUser).toHaveBeenCalledOnce();
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "student@kmla.hs.kr",
      password: "current-password",
    });
  });

  it("does not attempt password sign-in when the current user lookup fails", async () => {
    const error = new Error("expired session");
    getUser.mockResolvedValue({ data: { user: null }, error });

    await expect(reauthenticateWithPassword("password")).rejects.toBe(error);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("withdraws after re-entering the password of the current account", async () => {
    await withdrawAccount("current-pass");

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "student@kmla.hs.kr",
      password: "current-pass",
    });
    expect(rpc).toHaveBeenCalledWith("withdraw_account");
    expect(signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[0],
    );
  });

  // 계정이 지워진 뒤라 구독 해제 RPC와 `/logout`은 실패할 뿐이다.
  it("cleans up only this device after the account is gone", async () => {
    await withdrawAccount("current-pass");

    expect(disconnectWebPushForLogout).not.toHaveBeenCalled();
    expect(unsubscribeWebPushLocally).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });

  it("does not call the server when the password is wrong", async () => {
    const error = { code: "invalid_credentials" };
    signInWithPassword.mockResolvedValueOnce({ error });

    await expect(withdrawAccount("wrong-pass")).rejects.toBe(error);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports success once the server withdrew the account even if local cleanup fails", async () => {
    unsubscribeWebPushLocally.mockRejectedValueOnce(new Error("blocked"));
    signOut.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(withdrawAccount("current-pass")).resolves.toBeUndefined();
  });
});
