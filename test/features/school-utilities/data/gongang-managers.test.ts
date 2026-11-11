import { describe, expect, it, vi } from "vitest";

const { from, calls } = vi.hoisted(() => ({
  from: vi.fn(),
  calls: [] as unknown[][],
}));

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({ from }),
}));

import { loadGongangManagers } from "~/features/school-utilities/data/gongang-schedule";

describe("gongang manager names", () => {
  it("lists only holders of the gongang grant, oldest grant first, with their cohort", async () => {
    const builder = {
      select: (...args: unknown[]) => (
        calls.push(["select", ...args]),
        builder
      ),
      eq: (...args: unknown[]) => (calls.push(["eq", ...args]), builder),
      order: (...args: unknown[]) => (calls.push(["order", ...args]), builder),
      then: (resolve: (value: unknown) => void) =>
        resolve({
          data: [
            { profile_id: 5, profile: { name: "최진명", cohort: 30 } },
            { profile_id: 6, profile: { name: "김선생", cohort: null } },
          ],
          error: null,
        }),
    };
    from.mockReturnValue(builder);

    await expect(loadGongangManagers()).resolves.toEqual([
      { profileId: 5, label: "30기 최진명" },
      { profileId: 6, label: "김선생" },
    ]);
    expect(from).toHaveBeenCalledWith("profile_permissions");
    expect(calls).toContainEqual(["eq", "permission_key", "gongang.manage"]);
    expect(calls).toContainEqual(["order", "created_at"]);
  });
});
