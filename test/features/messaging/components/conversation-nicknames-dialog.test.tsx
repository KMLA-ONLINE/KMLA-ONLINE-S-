import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
  it("별명을 크게 먼저 표시하고 본명을 보조로 보여주며 안내 문구는 생략한다", () => {
    render(
      <ConversationNicknamesDialog
        participants={participants}
        viewerId="1"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const member = screen.getByRole("button", { name: "김민준 별명 변경" });
    expect(member).toHaveTextContent(/^민준이.*김민준/);
    expect(within(member).getByText("민준이")).toHaveClass("text-sm");
    expect(within(member).getByText("김민준")).toHaveClass("text-xs");
    expect(
      screen.queryByText("이 채팅의 모든 멤버에게 보입니다."),
    ).not.toBeInTheDocument();
  });

  it("저장 중 뒤로가기로 닫힌 화면은 응답이 와도 한 번 더 뒤로 가지 않는다", async () => {
    const user = userEvent.setup();
    let finish!: (saved: boolean) => void;
    const request = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const onSubmit = vi.fn().mockReturnValue(request);
    const onCancel = vi.fn();
    const { unmount } = render(
      <ConversationNicknamesDialog
        participants={participants}
        viewerId="1"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "김민준 별명 변경" }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    unmount();
    await act(async () => {
      finish(true);
      await request;
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Safari의 한글 조합 확정 Enter는 저장하지 않는다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <ConversationNicknamesDialog
        participants={participants}
        viewerId="1"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "김민준 별명 변경" }));
    const field = screen.getByRole("textbox", { name: "별명" });
    fireEvent.compositionEnd(field);
    fireEvent.keyDown(field, {
      key: "Enter",
      keyCode: 229,
      isComposing: false,
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field).toHaveValue("민준이");
    await user.click(field);
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("2", "민준이");
  });

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
