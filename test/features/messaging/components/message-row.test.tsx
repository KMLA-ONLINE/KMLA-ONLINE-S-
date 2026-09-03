import { describe, expect, it } from "vitest";

import { MessageRow } from "~/features/messaging/components/message-row";
import { TooltipProvider } from "~/shared/ui/tooltip";
import { renderRoute, screen } from "../../../router";

describe("MessageRow", () => {
  it("반응이 메시지 행 높이를 늘려도 아바타를 버블 하단에 정렬한다", () => {
    renderRoute(
      () => (
        <MessageRow
          message={{
            id: "message-1",
            senderId: "sender-1",
            body: "반응이 있는 메시지",
            sentAt: "오후 3:12",
            reactions: [{ reaction: "like", count: 1 }],
          }}
          sender={{
            id: "sender-1",
            name: "박서현",
            avatarUrl: null,
          }}
          isOwn={false}
          isGroup
          isPinned={false}
        />
      ),
      { path: "/messenger/test" },
    );

    expect(
      screen
        .getByRole("img", { name: "박서현 프로필 사진" })
        .closest('[data-slot="avatar"]'),
    ).toHaveClass("mb-[1.125rem]");
  });

  it("강조 링은 연결된 텍스트 버블의 모서리를 따른다", () => {
    renderRoute(
      () => (
        <MessageRow
          message={{
            id: "message-1",
            senderId: "viewer",
            body: "연결된 내 메시지",
            sentAt: "오후 3:12",
          }}
          isOwn
          isGroup={false}
          isPinned={false}
          startsGroup={false}
          endsGroup={false}
          highlighted
        />
      ),
      { path: "/messenger/test" },
    );

    expect(document.querySelector('[data-slot="message-bubble"]')).toHaveClass(
      "rounded-2xl",
      "rounded-tr-md",
      "rounded-br-md",
    );
  });

  it("강조 링은 이모지 전용 메시지를 pill 형태로 감싼다", () => {
    renderRoute(
      () => (
        <MessageRow
          message={{
            id: "message-1",
            senderId: "viewer",
            body: "👍",
            sentAt: "오후 3:12",
          }}
          isOwn
          isGroup={false}
          isPinned={false}
          highlighted
        />
      ),
      { path: "/messenger/test" },
    );

    expect(document.querySelector('[data-slot="message-bubble"]')).toHaveClass(
      "rounded-full",
    );
  });

  it("데스크톱에서 메시지에 마우스를 올리면 전송 시각 카드를 표시한다", async () => {
    const { user } = renderRoute(
      () => (
        <TooltipProvider>
          <MessageRow
            message={{
              id: "message-1",
              senderId: "viewer",
              body: "시간 카드를 확인할 메시지",
              sentAt: "오후 3:12",
            }}
            isOwn
            isGroup={false}
            isPinned={false}
          />
        </TooltipProvider>
      ),
      { path: "/messenger/test" },
    );

    await user.hover(document.querySelector('[data-slot="tooltip-trigger"]')!);

    expect(await screen.findByText("오후 3:12")).toBeInTheDocument();
  });
});
