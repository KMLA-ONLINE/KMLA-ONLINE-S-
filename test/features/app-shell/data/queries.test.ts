import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, getSupabase, rpc, signOut } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSupabase: vi.fn(),
  rpc: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({ getSupabase }));

import { loadShellData } from "~/features/app-shell/data/queries";

describe("shell data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabase.mockReturnValue({ auth: { getSession, signOut }, rpc });
    getSession.mockResolvedValue({
      data: { session: { user: { email: "student@kmla.hs.kr" } } },
      error: null,
    });
    signOut.mockResolvedValue({ error: null });
  });

  // 게이트는 `null`을 `/login`으로 옮긴다. 거절을 그대로 던지면 로그인 화면 대신 에러 화면이
  // 뜬다 — 사용자에게는 앱이 깨진 것으로 보인다.
  it("reports no session when the server rejects the request", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });

    await expect(loadShellData()).resolves.toBeNull();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("surfaces a skewed clock instead of signing the user out", async () => {
    const error = { code: "PGRST303", message: "JWT issued at future" };
    rpc.mockResolvedValue({ data: null, error });

    await expect(loadShellData()).rejects.toBe(error);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("loads the pending application count for an accepted admin", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "get_my_profile") {
        return Promise.resolve({
          data: [
            {
              id: 1,
              pub_id: "admin",
              name: "관리자",
              role: "admin",
              type: "student",
              status: "accepted",
              avatar_path: null,
            },
          ],
          error: null,
        });
      }
      if (name === "get_my_recent_unread_notification_count") {
        return Promise.resolve({ data: 2, error: null });
      }
      if (name === "admin_list_applications") {
        return Promise.resolve({ data: [{ total_count: 3 }], error: null });
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await expect(loadShellData()).resolves.toMatchObject({
      badges: { "/noti": 2, "/admin": 3 },
    });
    expect(rpc).toHaveBeenCalledWith("admin_list_applications", {
      p_status: "pending",
      p_limit: 1,
      p_offset: 0,
    });
  });
});
