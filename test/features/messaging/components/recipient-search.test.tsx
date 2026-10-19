import { afterEach, describe, expect, it, vi } from "vitest";

import { RecipientPickerDialog } from "~/features/messaging/components/recipient-picker-dialog";
import { SharePostDialog } from "~/features/messaging/components/share-post-dialog";
import * as queries from "~/features/messaging/data/queries";
import { renderRoute, screen } from "../../../router";

vi.mock("~/features/messaging/data/queries", () => import("../fake-api"));
afterEach(() => vi.restoreAllMocks());

it("게시물을 보낼 대화는 별명 대신 본명으로 구분한다", async () => {
  vi.spyOn(queries, "listConversations").mockResolvedValue([
    {
      id: "friend",
      type: "direct",
      name: "감자",
      viewerId: "me",
      participants: [
        {
          id: "friend",
          name: "감자",
          profileName: "김민준",
          nickname: "감자",
          avatarUrl: null,
          active: true,
        },
      ],
      lastMessage: null,
      unreadCount: 0,
      notificationLevel: "all",
      canDelete: false,
      hidden: false,
    },
  ]);
  const { user } = renderRoute(() => (
    <SharePostDialog
      open
      onOpenChange={vi.fn()}
      path="/groups/test/posts/id"
      title="게시물"
    />
  ));
  expect(await screen.findByText("김민준", { exact: true })).toBeVisible();
  await user.type(screen.getByRole("searchbox"), "김민준");
  expect(screen.getByText("김민준", { exact: true })).toBeVisible();
});

describe.each([
  [
    "recipient picker",
    () => (
      <RecipientPickerDialog
        open
        mode="create"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    ),
  ],
  [
    "post sharing",
    () => (
      <SharePostDialog
        open
        onOpenChange={vi.fn()}
        path="/groups/test/posts/post-id"
        title="테스트 게시물"
      />
    ),
  ],
] as const)("%s", (_name, Dialog) => {
  it("distinguishes a failed search from no matching people", async () => {
    vi.spyOn(queries, "searchMessageRecipients").mockRejectedValueOnce(
      new Error("offline"),
    );
    const { user } = renderRoute(Dialog);

    await user.type(screen.getByRole("searchbox"), "검색{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
    expect(
      screen.queryByText("일치하는 사람이 없습니다."),
    ).not.toBeInTheDocument();
  });
});
