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

import { clientAction, shouldRevalidate } from "~/routes/app/groups/detail";

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

/**
 * 규칙 자체는 `createPostListRevalidation`의 테스트가 확인한다. 이 route에만 있는 사실은
 * 검색 오버레이 파라미터(`search`, `q`)만 UI 전용으로 넘겼다는 것이라, 여기서는 그 목록이
 * 맞는지만 본다 — loader가 읽는 `tab`은 그 목록에 없어야 한다.
 */
describe("group detail revalidation", () => {
  it("ignores only the search overlay parameters", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/groups/test?tab=members"),
        nextUrl: new URL(
          "https://example.com/groups/test?tab=members&search=1&q=%EC%8B%9C%ED%97%98",
        ),
      } as never),
    ).toBe(false);
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://example.com/groups/test?search=1"),
        nextUrl: new URL("https://example.com/groups/test?tab=members"),
      } as never),
    ).toBe(true);
  });
});
