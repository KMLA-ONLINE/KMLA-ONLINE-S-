import { describe, expect, it, vi } from "vitest";

import { MessageReactionBar } from "~/features/messaging/components/message-reaction-bar";
import { renderRoute, screen, within } from "../../../router";

describe("MessageReactionBar", () => {
  it("빠른 반응 여섯 개와 더 보기 버튼을 보여 준다", () => {
    renderRoute(() => (
      <MessageReactionBar current={null} onSelect={vi.fn()} onMore={vi.fn()} />
    ));

    const bar = screen.getByRole("group", { name: "빠른 반응" });
    expect(
      within(bar)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["👍", "❤️", "😆", "😮", "😢", "😡", ""]);
    expect(
      screen.getByRole("button", { name: "다른 이모지 고르기" }),
    ).toBeInTheDocument();
  });

  it("이미 남긴 반응은 눌림 상태이고 다시 누르면 취소로 읽힌다", async () => {
    const onSelect = vi.fn();
    const { user } = renderRoute(() => (
      <MessageReactionBar current="❤️" onSelect={onSelect} onMore={vi.fn()} />
    ));

    const heart = screen.getByRole("button", { name: "❤️ 반응 취소" });
    expect(heart).toHaveAttribute("aria-pressed", "true");
    await user.click(heart);
    expect(onSelect).toHaveBeenCalledWith("❤️");
  });

  it("더 보기는 부모가 넘긴 선택창 열기를 부른다", async () => {
    const onMore = vi.fn();
    const onSelect = vi.fn();
    const { user } = renderRoute(() => (
      <MessageReactionBar current={null} onSelect={onSelect} onMore={onMore} />
    ));

    await user.click(
      screen.getByRole("button", { name: "다른 이모지 고르기" }),
    );
    expect(onMore).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
