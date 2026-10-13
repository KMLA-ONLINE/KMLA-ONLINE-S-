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

describe("app gate loader", () => {
  beforeEach(() => vi.clearAllMocks());

  // 게이트는 첫 진입에만 돈다. 이후 `refreshShellProfile()`이 이 쿼리를 다시 읽는다.
  it("seeds the shell profile query on entry", async () => {
    const shell = { email: "student@kmla.hs.kr", profile };
    mocks.loadShellData.mockResolvedValue(shell);

    await expect(clientLoader()).resolves.toEqual(shell);
    expect(getQueryClient().getQueryData(appShellKeys.profile())).toEqual(
      shell,
    );
  });

  it("does not seed the query for a user it turns away", async () => {
    mocks.loadShellData.mockResolvedValue({
      email: "student@kmla.hs.kr",
      profile: { ...profile, status: "pending" },
    });

    await expect(clientLoader()).rejects.toMatchObject({ status: 302 });
    expect(
      getQueryClient().getQueryData(appShellKeys.profile()),
    ).toBeUndefined();
  });
});
