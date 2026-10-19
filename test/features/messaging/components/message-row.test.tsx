import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";

import { MessageRow } from "~/features/messaging/components/message-row";
import { formatMessageTime } from "~/features/messaging/model/message-time";
import { renderRoute, screen } from "../../../router";

const sentAt = "2026-08-28T06:12:00.000Z";

describe("MessageRow", () => {
  it("메시지 작성자에는 별명만 표시한다", () => {
    const sender = {
      id: "peer",
      name: "감자",
      profileName: "김민준",
      avatarUrl: null,
      active: true,
    };
    renderRoute(
      () => (
        <MessageRow
          message={{ id: "m1", senderId: "peer", body: "안녕", sentAt }}
          sender={sender}
          isOwn={false}
          isGroup
          isPinned={false}
        />
      ),
      { path: "/messenger/room" },
    );

    const row = screen.getByRole("article", { name: "감자 메시지" });
    expect(row).toHaveTextContent(/^감자안녕$/);
    expect(row).not.toHaveTextContent("김민준");
  });

  it("별명이 설정되지 않은 작성자는 프로필 이름을 표시한다", () => {
    const sender = {
      id: "peer",
      name: "김민준",
      profileName: "김민준",
      avatarUrl: null,
      active: true,
    };
    renderRoute(
      () => (
        <MessageRow
          message={{ id: "m2", senderId: "peer", body: "또 봐", sentAt }}
          sender={sender}
          isOwn={false}
          isGroup
          isPinned={false}
        />
      ),
      { path: "/messenger/room" },
    );
    const row = screen.getByRole("article", { name: "김민준 메시지" });
    expect(row).toHaveTextContent(/^김민준또 봐$/);
  });

  it("내 메시지의 접근성 이름은 본명이나 별명으로 바뀌지 않는다", () => {
    renderRoute(
      () => (
        <MessageRow
          message={{ id: "m3", senderId: "me", body: "안녕", sentAt }}
          sender={{
            id: "me",
            name: "내 별명",
            profileName: "본명",
            avatarUrl: null,
            active: true,
          }}
          isOwn
          isGroup
          isPinned={false}
        />
      ),
      { path: "/messenger/room" },
    );

    expect(
      screen.getByRole("article", { name: "내 메시지" }),
    ).toBeInTheDocument();
  });

  it("버블을 누르면 시간 카드를 열고 눌러도 닫지 않는다", async () => {
    const user = userEvent.setup();
    renderMessage();

    await user.click(screen.getByText("안녕"));
    expect(await screen.findByText(formatMessageTime(sentAt))).toBeVisible();

    await user.click(screen.getByText("안녕"));
    expect(screen.getByText(formatMessageTime(sentAt))).toBeVisible();
  });

  it("손가락으로 탭하면 버블 안에 시각을 켜고 다시 탭하면 끈다", async () => {
    const user = userEvent.setup();
    renderMessage();
    const bubble = screen.getByText("안녕");
    const time = () =>
      screen.queryByText(formatMessageTime(sentAt), { selector: "time" });

    await user.pointer({ keys: "[TouchA]", target: bubble });
    expect(time()).toBeInTheDocument();
    // 손가락으로 누를 때는 버블 안에 보이므로 시간 카드는 띄우지 않는다.
    expect(screen.getAllByText(formatMessageTime(sentAt))).toHaveLength(1);

    await user.pointer({ keys: "[TouchA]", target: bubble });
    expect(time()).not.toBeInTheDocument();
  });

  it("링크를 탭하면 시각을 켜지 않는다", async () => {
    const user = userEvent.setup();
    renderMessage("https://example.com");

    await user.pointer({
      keys: "[TouchA]",
      target: screen.getByRole("link", { name: "https://example.com" }),
    });
    expect(
      screen.queryByText(formatMessageTime(sentAt)),
    ).not.toBeInTheDocument();
  });
});

function renderMessage(body = "안녕") {
  renderRoute(
    () => (
      <MessageRow
        message={{ id: "m1", senderId: "me", body, sentAt }}
        isOwn
        isGroup={false}
        isPinned={false}
      />
    ),
    { path: "/messenger/room" },
  );
}
