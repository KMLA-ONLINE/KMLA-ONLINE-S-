import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPostPreviews } = vi.hoisted(() => ({
  listPostPreviews: vi.fn(),
}));

vi.mock("~/features/posts/data/queries", () => ({ listPostPreviews }));

import { MessageBubble } from "~/features/messaging/components/message-bubble";
import type { ConversationMessage } from "~/features/messaging/model/types";
import { renderRoute, screen } from "../../../router";

const POST_ID = "6f1c2a4e-8b3d-4c5e-9a7f-0123456789ab";
const PATH = `/groups/band/posts/${POST_ID}`;

function sharedMessage(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: "m1",
    senderId: "me",
    body: `${window.location.origin}${PATH}`,
    sentAt: "2026-10-15T06:00:00.000Z",
    unreadMemberCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  listPostPreviews.mockReset().mockResolvedValue(
    new Map([
      [
        POST_ID,
        {
          postId: POST_ID,
          kind: "group",
          groupName: "밴드부",
          title: "공연 안내",
          body: "토요일",
          authorLabel: "이한별",
          authorAvatarUrl: null,
          imageUrl: null,
        },
      ],
    ]),
  );
});

describe("MessageBubble shared post", () => {
  it("keeps the edited marker on a link-only message drawn as a card", async () => {
    renderRoute(() => (
      <MessageBubble
        message={sharedMessage({ editedAt: "2026-10-15T06:01:00.000Z" })}
        isOwn
      />
    ));

    expect(
      await screen.findByRole("link", { name: /공연 안내/ }),
    ).toHaveAttribute("href", PATH);
    expect(screen.getByText("수정됨")).toBeInTheDocument();
  });

  it("draws a link-only reply as a card under its quote", async () => {
    const onViewReply = vi.fn();
    const { user } = renderRoute(() => (
      <MessageBubble
        message={sharedMessage()}
        isOwn={false}
        replyTarget={{ id: "m0", senderId: "you", body: "뭐 볼까" }}
        replyTargetAuthor="박새벽"
        onViewReply={onViewReply}
      />
    ));

    expect(
      await screen.findByRole("link", { name: /공연 안내/ }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "박새벽의 원문 메시지 보기" }),
    );
    expect(onViewReply).toHaveBeenCalled();
  });

  it("keeps a file captioned with a post link as a plain link", () => {
    renderRoute(() => (
      <MessageBubble
        message={sharedMessage({
          attachments: [
            {
              id: "a1",
              kind: "file",
              mimeType: "application/pdf",
              sizeBytes: 10,
              width: null,
              height: null,
              fileName: "notes.pdf",
              objectPath: "c/a1",
              thumbnailPath: null,
            },
          ],
        })}
        isOwn
      />
    ));

    expect(
      screen.getByRole("link", { name: `${window.location.origin}${PATH}` }),
    ).toBeInTheDocument();
    expect(listPostPreviews).not.toHaveBeenCalled();
  });
});
