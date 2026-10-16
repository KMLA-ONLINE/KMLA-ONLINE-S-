import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadShellData: vi.fn() }));

vi.mock("~/features/app-shell", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadShellData: mocks.loadShellData,
}));

vi.mock("~/features/notifications", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notificationBadgeQuery: () => ({
    queryKey: ["notifications", "badge"],
    queryFn: () => 0,
  }),
}));

import { appShellKeys } from "~/features/app-shell";
import { getQueryClient } from "~/shared/lib/query-client";
import { clientLoader } from "~/routes/app/gate";

const profile = {
  id: 1,
  pub_id: "student",
  name: "홍길동",
  role: "member",
  type: "student",
  status: "accepted",
  avatar_path: null,
} as const;

function args(path = "/") {
  return {
    request: new Request(`https://kmla.online${path}`),
    params: {},
    context: undefined,
  } as unknown as Parameters<typeof clientLoader>[0];
}

describe("app gate loader", () => {
  beforeEach(() => vi.clearAllMocks());

  // 게이트는 첫 진입에만 돈다. 이후 `refreshShellProfile()`이 이 쿼리를 다시 읽는다.
  it("seeds the shell profile query on entry", async () => {
    const shell = { email: "student@kmla.hs.kr", profile };
    mocks.loadShellData.mockResolvedValue({ ...shell, suspended: false });

    await expect(clientLoader(args())).resolves.toEqual(shell);
    expect(getQueryClient().getQueryData(appShellKeys.profile())).toEqual(
      shell,
    );
  });

  it("does not seed the query for a user it turns away", async () => {
    mocks.loadShellData.mockResolvedValue({
      email: "student@kmla.hs.kr",
      profile: { ...profile, status: "pending" },
      suspended: false,
    });

    await expect(clientLoader(args())).rejects.toMatchObject({ status: 302 });
    expect(
      getQueryClient().getQueryData(appShellKeys.profile()),
    ).toBeUndefined();
  });

  // 이용 정지된 사람의 상태는 `accepted` 그대로라 상태만 보면 앱으로 들어온다.
  it("sends a suspended member to the suspension notice", async () => {
    mocks.loadShellData.mockResolvedValue({
      email: "student@kmla.hs.kr",
      profile,
      suspended: true,
    });

    const thrown = await clientLoader(args()).catch((error: unknown) => error);
    expect((thrown as Response).headers.get("Location")).toBe("/suspended");
  });

  // 공유받은 링크로 들어왔다가 로그인을 거쳐도 그 화면으로 돌아오게 한다.
  it("sends a signed-out visitor to login with the requested path", async () => {
    mocks.loadShellData.mockResolvedValue(null);

    const thrown = await clientLoader(args("/group/7/post/9?c=3")).catch(
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe(
      `/login?${new URLSearchParams({ next: "/group/7/post/9?c=3" })}`,
    );

    const home = await clientLoader(args("/")).catch((error: unknown) => error);
    expect((home as Response).headers.get("Location")).toBe("/login");
  });
});
