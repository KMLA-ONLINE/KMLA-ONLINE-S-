import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";

const mutations = vi.hoisted(() => ({
  approveGroupJoinRequest: vi.fn(),
  rejectGroupJoinRequest: vi.fn(),
  setGroupMemberRole: vi.fn(),
  transferGroupOwnership: vi.fn(),
  updateGroupSettings: vi.fn(),
}));

vi.mock("~/features/groups", async (importOriginal) => ({
  ...(await importOriginal()),
  ...mutations,
}));

import { clientAction } from "~/routes/app/groups/detail";

function action(body: URLSearchParams) {
  return clientAction({
    request: new Request("https://example.com/groups/test", {
      method: "POST",
      body,
    }),
    params: { slug: "test" },
    context: new RouterContextProvider(),
    url: new URL("https://example.com/groups/test"),
    pattern: "/groups/:slug",
    serverAction: () => Promise.resolve(undefined),
  });
}

describe("group detail management action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dispatches member moderation and ownership intents", async () => {
    await action(
      new URLSearchParams({
        intent: "approve-join-request",
        groupId: "group",
        requestId: "request",
      }),
    );
    await action(
      new URLSearchParams({
        intent: "set-member-role",
        groupId: "group",
        memberId: "member",
        role: "manager",
      }),
    );
    await action(
      new URLSearchParams({
        intent: "transfer-ownership",
        groupId: "group",
        memberId: "admin",
      }),
    );

    expect(mutations.approveGroupJoinRequest).toHaveBeenCalledWith(
      "group",
      "request",
    );
    expect(mutations.setGroupMemberRole).toHaveBeenCalledWith(
      "group",
      "member",
      "manager",
    );
    expect(mutations.transferGroupOwnership).toHaveBeenCalledWith(
      "group",
      "admin",
    );
  });

  it("validates and dispatches settings", async () => {
    const result = await action(
      new URLSearchParams({
        intent: "update-settings",
        groupId: "group",
        name: "새 이름",
        description: "설명",
        joinPolicy: "request",
        identityPolicy: "optional_anonymous",
        postingPolicy: "staff",
      }),
    );
    expect(result).toMatchObject({ data: { ok: true } });
    expect(mutations.updateGroupSettings).toHaveBeenCalledWith("group", {
      name: "새 이름",
      description: "설명",
      joinPolicy: "request",
      identityPolicy: "optional_anonymous",
      postingPolicy: "staff",
    });
  });

  it("rejects an owner role through the ordinary role action", async () => {
    const result = await action(
      new URLSearchParams({
        intent: "set-member-role",
        groupId: "group",
        memberId: "member",
        role: "owner",
      }),
    );
    expect(result).toMatchObject({ init: { status: 400 } });
    expect(mutations.setGroupMemberRole).not.toHaveBeenCalled();
  });

  it.each([
    ["   ", "설명"],
    ["가".repeat(51), "설명"],
    ["이름", "가".repeat(2001)],
  ])("rejects invalid settings lengths", async (name, description) => {
    const result = await action(
      new URLSearchParams({
        intent: "update-settings",
        groupId: "group",
        name,
        description,
        joinPolicy: "request",
        identityPolicy: "identified",
        postingPolicy: "members",
      }),
    );

    expect(result).toMatchObject({ init: { status: 400 } });
    expect(mutations.updateGroupSettings).not.toHaveBeenCalled();
  });
});
