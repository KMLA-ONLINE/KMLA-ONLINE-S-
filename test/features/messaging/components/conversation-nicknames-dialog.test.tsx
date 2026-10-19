import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConversationNicknamesDialog } from "~/features/messaging/components/conversation-nicknames-dialog";

const participants = [
  {
    id: "1",
    name: "홍길동",
    profileName: "홍길동",
    avatarUrl: null,
    active: true,
  },
  {
    id: "2",
    name: "민준이",
    profileName: "김민준",
    nickname: "민준이",
    avatarUrl: null,
    active: true,
  },
];

describe("채팅 별명 편집", () => {
  it("멤버를 고르고 별명을 저장하면 닫는다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onCancel = vi.fn();
    render(
      <ConversationNicknamesDialog
        participants={participants}
        viewerId="1"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "김민준 별명 변경" }));
    const field = screen.getByRole("textbox", { name: "별명" });
    expect(field).toHaveValue("민준이");
    await user.clear(field);
    await user.type(field, "민준 최고");
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(onSubmit).toHaveBeenCalledWith("2", "민준 최고");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("원래 이름으로 되돌릴 수 있고 저장 실패 시 입력을 유지한다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(false);
    const onCancel = vi.fn();
    render(
      <ConversationNicknamesDialog
        participants={participants}
        viewerId="1"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "김민준 별명 변경" }));
    await user.click(screen.getByRole("button", { name: "원래 이름으로" }));
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(onSubmit).toHaveBeenCalledWith("2", "");
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "별명" })).toHaveValue("");
  });
});
