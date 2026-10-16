import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, getSupabase, rpc, signOut } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSupabase: vi.fn(),
  rpc: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({ getSupabase }));

import {
  discardPrefetchedShellData,
  loadShellData,
  prefetchShellData,
} from "~/features/app-shell/data/queries";

/** 셸 데이터를 한 번 읽을 때마다 프로필을 한 번 읽는다. */
function profileReads(): number {
  return rpc.mock.calls.filter(([name]) => name === "get_my_profile").length;
}

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

  it("hands a prefetched profile to the next load only once", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: 1,
          pub_id: "student",
          name: "홍길동",
          role: "member",
          type: "student",
          status: "accepted",
          avatar_path: null,
        },
      ],
      error: null,
    });

    prefetchShellData();
    await expect(loadShellData()).resolves.toMatchObject({
      profile: { pub_id: "student" },
    });
    expect(profileReads()).toBe(1);

    await loadShellData();
    expect(profileReads()).toBe(2);
  });

  // 착지점에서 로그인으로 보낸 뒤 돌아오면, 미리 읽은 "로그인 안 됨"을 쓰면 안 된다.
  it("reads again when the prefetch found no session", async () => {
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    rpc.mockResolvedValue({ data: [], error: null });

    prefetchShellData();
    await expect(loadShellData()).resolves.toMatchObject({ profile: null });
    expect(profileReads()).toBe(1);
  });

  // 미리 읽기가 일시적 오류로 실패했다고 원래 열렸을 화면이 에러가 되면 안 된다.
  it("reads again when the prefetch failed", async () => {
    getSession.mockRejectedValueOnce(new Error("offline"));
    rpc.mockResolvedValue({ data: [], error: null });

    prefetchShellData();
    await expect(loadShellData()).resolves.toMatchObject({ profile: null });
    expect(profileReads()).toBe(1);
  });

  it("does not hand over a discarded prefetch", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    prefetchShellData();
    discardPrefetchedShellData();
    await loadShellData();
    expect(profileReads()).toBe(2);
  });

  // 정지돼도 프로필 상태는 `accepted`다. 게이트가 정지 안내로 보낼 수 있게 따로 싣는다.
  it("reports whether the member is suspended", async () => {
    const row = {
      id: 1,
      pub_id: "student",
      name: "홍길동",
      role: "member",
      type: "student",
      status: "accepted",
      avatar_path: null,
    };
    rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data:
          name === "get_my_suspension"
            ? [{ reason: "분탕 행위 확인", expires_at: null }]
            : [row],
        error: null,
      }),
    );

    await expect(loadShellData()).resolves.toMatchObject({ suspended: true });

    rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data: name === "get_my_suspension" ? [] : [row],
        error: null,
      }),
    );
    await expect(loadShellData()).resolves.toMatchObject({ suspended: false });
  });
});
