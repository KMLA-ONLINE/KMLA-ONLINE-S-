import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  disconnectWebPushForLogout,
  getSession,
  getSupabase,
  signInWithPassword,
  signOut,
} = vi.hoisted(() => ({
  disconnectWebPushForLogout: vi.fn(),
  getSession: vi.fn(),
  getSupabase: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({ getSupabase }));
vi.mock("~/features/notifications", () => ({ disconnectWebPushForLogout }));

import { signIn } from "~/features/auth/data/mutations";

describe("auth mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabase.mockReturnValue({
      auth: { getSession, signInWithPassword, signOut },
    });
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    disconnectWebPushForLogout.mockResolvedValue(undefined);
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
});
