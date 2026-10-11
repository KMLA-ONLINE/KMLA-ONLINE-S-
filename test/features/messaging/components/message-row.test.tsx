import { describe, expect, it } from "vitest";

import { MessageRow } from "~/features/messaging/components/message-row";
import { TooltipProvider } from "~/shared/ui/tooltip";
import { renderRoute, screen } from "../../../router";

describe("MessageRow", () => {
  it("데스크톱에서 메시지에 마우스를 올리면 전송 시각 카드를 표시한다", async () => {
    const { user } = renderRoute(
      () => (
        <TooltipProvider>
          <MessageRow
            message={{
              id: "message-1",
              senderId: "viewer",
              body: "시간 카드를 확인할 메시지",
              sentAt: "2026-08-28T15:12:00+09:00",
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
