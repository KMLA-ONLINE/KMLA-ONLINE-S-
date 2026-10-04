import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listGroupMembers = vi.hoisted(() => vi.fn());

vi.mock("~/features/groups", async (importOriginal) => ({
  ...(await importOriginal()),
  listGroupMembers,
}));

import { clientLoader } from "~/routes/app/groups/member-page";

function load(search: string) {
  const url = new URL(`https://example.com/groups/member-page?${search}`);
  return clientLoader({
    request: new Request(url),
    params: {},
    context: new RouterContextProvider(),
    url,
    pattern: "/groups/member-page",
    serverLoader: () => Promise.resolve(undefined),
  });
}

describe("group member page loader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts an ISO timestamp cursor", async () => {
    listGroupMembers.mockResolvedValue({ members: [], nextCursor: null });

    await load(
      "groupId=group&afterRole=member&afterJoinedAt=2026-01-01T00%3A00%3A00Z&afterId=membership",
    );

    expect(listGroupMembers).toHaveBeenCalledWith("group", "", {
      role: "member",
      joinedAt: "2026-01-01T00:00:00Z",
      membershipId: "membership",
    });
  });

  it("rejects a parseable non-ISO timestamp cursor", async () => {
    await expect(
      load(
        "groupId=group&afterRole=member&afterJoinedAt=January+1%2C+2026&afterId=membership",
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(listGroupMembers).not.toHaveBeenCalled();
  });
});
