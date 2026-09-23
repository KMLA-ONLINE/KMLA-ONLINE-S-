import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSupabase, rpc, getUser, signInWithPassword } = vi.hoisted(() => ({
  getSupabase: vi.fn(),
  rpc: vi.fn(),
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({ getSupabase }));

import {
  reauthenticateWithPassword,
  reviewApplications,
} from "~/features/admin/data/mutations";
import {
  listAcceptedUsers,
  listApplications,
} from "~/features/admin/data/queries";

describe("admin data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabase.mockReturnValue({
      rpc,
      auth: { getUser, signInWithPassword },
    });
    rpc.mockResolvedValue({ data: [], error: null });
  });

  it("loads application and accepted-user screens with the RPC maximum", async () => {
    await listApplications("pending");
    await listAcceptedUsers("홍길동");

    expect(rpc).toHaveBeenNthCalledWith(1, "admin_list_applications", {
      p_status: "pending",
      p_limit: 200,
      p_offset: 0,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "admin_list_accepted_users", {
      p_query: "홍길동",
      p_limit: 200,
      p_offset: 0,
      p_managers_only: false,
    });
  });

  it("passes the complete selected application set to one review RPC", async () => {
    await reviewApplications([11, 12], "blocked");

    expect(rpc).toHaveBeenCalledWith("admin_review_applications", {
      p_profile_ids: [11, 12],
      p_status: "blocked",
    });
  });

  it("reauthenticates the current account without accepting a caller email", async () => {
    getUser.mockResolvedValue({
      data: { user: { email: "admin@example.com" } },
      error: null,
    });
    signInWithPassword.mockResolvedValue({ error: null });

    await reauthenticateWithPassword("current-password");

    expect(getUser).toHaveBeenCalledOnce();
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: "current-password",
    });
  });

  it("does not attempt password sign-in when the current user lookup fails", async () => {
    const error = new Error("expired session");
    getUser.mockResolvedValue({ data: { user: null }, error });

    await expect(reauthenticateWithPassword("password")).rejects.toBe(error);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
