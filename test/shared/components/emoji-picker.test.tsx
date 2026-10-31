import { describe, expect, it, vi } from "vitest";

import { EmojiPicker } from "~/shared/components/emoji-picker";
import { renderRoute, screen, within } from "../../router";

describe("EmojiPicker", () => {
  it("분류 탭을 보여 주고, 검색하면 이름·태그로 찾아 고른 이모지를 돌려준다", async () => {
    const onSelect = vi.fn();
    const { user } = renderRoute(() => (
      <EmojiPicker open onOpenChange={vi.fn()} onSelect={onSelect} />
    ));

    const picker = await screen.findByRole("dialog", { name: "이모지 선택" });
    expect(
      within(picker).getByRole("button", { name: "웃는 얼굴과 감정" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(picker).getByRole("button", { name: "활짝 웃는 얼굴" }),
    ).toBeInTheDocument();

    await user.click(within(picker).getByRole("button", { name: "깃발" }));
    expect(
      within(picker).getByRole("button", { name: "깃발: 대한민국" }),
    ).toBeInTheDocument();

    await user.type(within(picker).getByRole("searchbox"), "따봉");
    expect(
      within(picker).queryByRole("group", { name: "이모지 분류" }),
    ).not.toBeInTheDocument();
    await user.click(within(picker).getByRole("button", { name: "올린 엄지" }));
    expect(onSelect).toHaveBeenCalledWith("👍");
  });

  it("맞는 이모지가 없으면 그렇게 말한다", async () => {
    const { user } = renderRoute(() => (
      <EmojiPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} />
    ));
    const picker = await screen.findByRole("dialog", { name: "이모지 선택" });
    await user.type(within(picker).getByRole("searchbox"), "zzzz없음");
    expect(
      within(picker).getByText("“zzzz없음”에 맞는 이모지가 없습니다."),
    ).toBeInTheDocument();
  });
});
