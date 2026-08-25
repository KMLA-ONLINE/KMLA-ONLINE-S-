import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSignedUrls, from } = vi.hoisted(() => ({
  createSignedUrls: vi.fn(),
  from: vi.fn(),
}));

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({ from, storage: { from } }),
}));

import { loadUtilityReservations } from "~/features/school-utilities/data/reservations";

function reservation(id: number, avatarPath: string | null) {
  return {
    id,
    profile_id: id,
    mode: "gongang",
    reservation_date: "2026-08-25",
    slot: "1",
    location: null,
    detail: "",
    recurring: false,
    recurring_until: null,
    applicant_name: `사용자 ${id}`,
    avatar_path: avatarPath,
    profiles: { cohort: 30, pub_id: `user-${id}` },
  };
}

describe("utility reservation avatar hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let queryIndex = 0;
    from.mockImplementation((bucket: string) => {
      if (bucket === "profile-media") return { createSignedUrls };

      const result =
        queryIndex++ === 0
          ? { data: [reservation(1, "avatars/shared")], error: null }
          : {
              data: [
                reservation(2, "avatars/shared"),
                reservation(3, "https://example.com/avatar.png"),
              ],
              error: null,
            };
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lte: () => builder,
        or: () => builder,
        then: (resolve: (value: typeof result) => void) =>
          Promise.resolve(result).then(resolve),
      };
      return builder;
    });
    createSignedUrls.mockResolvedValue({
      data: [{ path: "avatars/shared", signedUrl: "signed-avatar" }],
      error: null,
    });
  });

  it("signs unique private avatar paths in one request", async () => {
    const result = await loadUtilityReservations(
      "gongang",
      "2026-08-24",
      "2026-08-30",
    );

    expect(createSignedUrls).toHaveBeenCalledOnce();
    expect(createSignedUrls).toHaveBeenCalledWith(["avatars/shared"], 3600);
    expect(result.map((item) => item.avatarUrl)).toEqual([
      "signed-avatar",
      "signed-avatar",
      "https://example.com/avatar.png",
    ]);
  });
});
