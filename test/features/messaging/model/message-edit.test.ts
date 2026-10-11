import { describe, expect, it } from "vitest";

import {
  canEditMessage,
  MESSAGE_EDIT_WINDOW_MS,
} from "~/features/messaging/model/message-edit";

const sentAt = "2026-08-28T06:00:00.000Z";
const message = { id: "m", senderId: "me", body: "본문", sentAt };
const sent = Date.parse(sentAt);

describe("canEditMessage", () => {
  it("내 메시지를 15분 안에만 고칠 수 있다", () => {
    expect(
      canEditMessage(message, "me", sent + MESSAGE_EDIT_WINDOW_MS - 1),
    ).toBe(true);
    expect(canEditMessage(message, "me", sent + MESSAGE_EDIT_WINDOW_MS)).toBe(
      false,
    );
  });

  it("남의 메시지와 삭제된 메시지는 고칠 수 없다", () => {
    expect(canEditMessage(message, "other", sent)).toBe(false);
    expect(canEditMessage({ ...message, deleted: true }, "me", sent)).toBe(
      false,
    );
  });

  it("서버가 확정하기 전의 메시지는 고칠 수 없다", () => {
    expect(canEditMessage({ ...message, pending: true }, "me", sent)).toBe(
      false,
    );
  });
});
