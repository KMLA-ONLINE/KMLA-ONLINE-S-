import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";

import { MessageRow } from "~/features/messaging/components/message-row";
import { formatMessageTime } from "~/features/messaging/model/message-time";
import { renderRoute, screen } from "../../../router";

const sentAt = "2026-08-28T06:12:00.000Z";

describe("MessageRow", () => {
  it("버블을 누르면 시간 카드를 열고 눌러도 닫지 않는다", async () => {
    const user = userEvent.setup();
    renderRoute(
      () => (
        <MessageRow
          message={{ id: "m1", senderId: "me", body: "안녕", sentAt }}
          isOwn
          isGroup={false}
          isPinned={false}
        />
      ),
      { path: "/messenger/room" },
    );

    await user.click(screen.getByText("안녕"));
    expect(await screen.findByText(formatMessageTime(sentAt))).toBeVisible();

    await user.click(screen.getByText("안녕"));
    expect(screen.getByText(formatMessageTime(sentAt))).toBeVisible();
  });
});
