import { AuthApiError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, getSupabase, rpc, signOut } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSupabase: vi.fn(),
  rpc: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({ getSupabase }));

import { hasActiveSession, loadAuthState } from "~/features/auth/data/queries";

const SESSION = { user: { email: "student@kmla.hs.kr" } };

describe("auth queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabase.mockReturnValue({ auth: { getSession, signOut }, rpc });
    getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    rpc.mockResolvedValue({ data: [], error: null });
    signOut.mockResolvedValue({ error: null });
  });

  // 게이트는 `null`만 `/login`으로 옮긴다. 거절을 던지면 루트 ErrorBoundary가 잡아
  // 사용자에게는 앱이 깨진 것으로 보인다.
  it.each([
    ["PGRST301", "JWT expired"],
    ["PGRST302", "anonymous access disabled"],
    ["42501", "permission denied for function get_my_profile"],
  ])(
    "signs out and reports no session when the server rejects %s",
    async (code, message) => {
      rpc.mockResolvedValue({ data: null, error: { code, message } });

      await expect(loadAuthState()).resolves.toBeNull();
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    },
  );

  // 시계가 어긋난 것이라 다시 로그인해도 새 토큰이 똑같이 거절된다. 여기서 로그아웃시키면
  // 게이트와 로그인 화면 사이를 무한히 오간다.
  it("keeps the session and surfaces the error when the clock is skewed", async () => {
    const error = { code: "PGRST303", message: "JWT issued at future" };
    rpc.mockResolvedValue({ data: null, error });

    await expect(loadAuthState()).rejects.toBe(error);
    expect(signOut).not.toHaveBeenCalled();
  });

  // 키를 잘못 넣었을 때 오는 응답에는 `code`가 없다. 설정 오류지 세션 문제가 아니다.
  it("keeps the session and surfaces an invalid API key", async () => {
    const error = { message: "Invalid API key" };
    rpc.mockResolvedValue({ data: null, error });

    await expect(loadAuthState()).rejects.toBe(error);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs out and reports no session when the refresh token is rejected", async () => {
    getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError(
        "Invalid Refresh Token",
        400,
        "refresh_token_not_found",
      ),
    });

    await expect(loadAuthState()).resolves.toBeNull();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  // 잠깐 끊긴 것과 세션이 죽은 것은 다르다. 전자로 로그아웃시키면 지하철에서 앱을 열었다는
  // 이유로 계정이 풀린다.
  it("keeps the session when the refresh fails because the browser is offline", async () => {
    const error = new TypeError("Failed to fetch");
    getSession.mockResolvedValue({ data: { session: null }, error });

    await expect(loadAuthState()).rejects.toBe(error);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("reads the profile once the session is live", async () => {
    rpc.mockResolvedValue({ data: [{ status: "accepted" }], error: null });

    await expect(loadAuthState()).resolves.toEqual({
      email: "student@kmla.hs.kr",
      profile: { status: "accepted" },
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  // 이 가드의 계약은 "요청을 보내지 않는다"이다. 던지면 부르는 로더가 대신 깨진다.
  it("never throws from the pre-request session guard", async () => {
    getSession.mockResolvedValue({
      data: { session: null },
      error: new TypeError("Failed to fetch"),
    });

    await expect(hasActiveSession()).resolves.toBe(false);
  });
});
