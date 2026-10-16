import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PostReactionButton } from "~/features/posts/components/reaction/post-reaction-button";
import type { ReactionSummary } from "~/features/posts/model/types";

function renderButton(summary: Partial<ReactionSummary> = {}) {
  const onSelect = vi.fn();
  const onClear = vi.fn();
  render(
    <PostReactionButton
      summary={{
        reaction_count: 2,
        top_reactions: ["like"],
        my_reaction: null,
        ...summary,
      }}
      onSelect={onSelect}
      onClear={onClear}
    />,
  );
  return { onSelect, onClear };
}

/** 롱프레스는 타이머가 지나야 성립한다. userEvent는 실제 시간을 쓰므로 fireEvent로 민다. */
function press(button: HTMLElement, heldMs: number) {
  fireEvent.pointerDown(button);
  act(() => void vi.advanceTimersByTime(heldMs));
  fireEvent.pointerUp(button);
  fireEvent.click(button);
}

describe("PostReactionButton", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("adds the default reaction on a short press", () => {
    const { onSelect } = renderButton();

    press(screen.getByRole("button", { name: "좋아요 남기기" }), 100);

    expect(onSelect).toHaveBeenCalledWith("like");
  });

  it("removes the existing reaction on a short press", () => {
    const { onClear, onSelect } = renderButton({ my_reaction: "love" });

    press(screen.getByRole("button", { name: "하트 취소" }), 100);

    expect(onClear).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens the picker on a long press without toggling", () => {
    const { onSelect, onClear } = renderButton();

    press(screen.getByRole("button", { name: "좋아요 남기기" }), 400);

    // 꾹 누른 손가락은 떼면서 click도 낸다. 그 click까지 토글로 처리하면 피커를 여는 동시에
    // 기본 반응이 붙는다.
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "웃겨요 반응 남기기" }),
    ).toBeInTheDocument();
  });

  it("picks a specific reaction from the picker", () => {
    const { onSelect } = renderButton();

    press(screen.getByRole("button", { name: "좋아요 남기기" }), 400);
    fireEvent.click(screen.getByRole("button", { name: "슬퍼요 반응 남기기" }));

    expect(onSelect).toHaveBeenCalledWith("sad");
  });

  it("clears when the picker repeats the current reaction", () => {
    const { onClear, onSelect } = renderButton({ my_reaction: "wow" });

    press(screen.getByRole("button", { name: "놀라워요 취소" }), 400);
    // 줄이 여는 버튼을 덮으므로 줄 안에서도 지금 반응을 알려 준다.
    const current = screen.getByRole("button", { name: "놀라워요 반응 취소" });
    expect(current).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(current);

    expect(onClear).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens the picker for a mouse that lingers on the button", () => {
    renderButton();

    fireEvent.pointerOver(
      screen.getByRole("button", { name: "좋아요 남기기" }),
      {
        pointerType: "mouse",
      },
    );
    act(() => void vi.advanceTimersByTime(1000));

    expect(
      screen.getByRole("button", { name: "웃겨요 반응 남기기" }),
    ).toBeInTheDocument();
  });

  it("closes a hover-opened picker once the mouse moves away", () => {
    renderButton();
    const button = screen.getByRole("button", { name: "좋아요 남기기" });

    fireEvent.pointerOver(button, { pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(1000));
    // hover로 연 줄에는 바깥 클릭 막이를 깔지 않는다. 깔면 마우스가 떠나도 닫히지 않는다.
    expect(
      screen.queryByRole("button", { name: "반응 선택 닫기" }),
    ).not.toBeInTheDocument();

    fireEvent.pointerOut(button, { pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(1000));

    expect(
      screen.queryByRole("button", { name: "웃겨요 반응 남기기" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a hover-opened picker while the mouse crosses into it", () => {
    renderButton();
    const button = screen.getByRole("button", { name: "좋아요 남기기" });

    fireEvent.pointerOver(button, { pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(1000));
    // 버튼과 줄 사이 틈을 건너는 동안 잠깐 밖에 나간다.
    fireEvent.pointerOut(button, { pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(100));
    fireEvent.pointerOver(
      screen.getByRole("button", { name: "웃겨요 반응 남기기" }),
      { pointerType: "mouse" },
    );
    act(() => void vi.advanceTimersByTime(1000));

    expect(
      screen.getByRole("button", { name: "웃겨요 반응 남기기" }),
    ).toBeInTheDocument();
  });

  it("ignores a touch that only grazes the button", () => {
    // 터치에는 hover가 없다. 여기서 열면 스크롤하다 스친 버튼이 멋대로 피커를 편다.
    renderButton();

    fireEvent.pointerOver(
      screen.getByRole("button", { name: "좋아요 남기기" }),
      {
        pointerType: "touch",
      },
    );
    act(() => void vi.advanceTimersByTime(1000));

    expect(
      screen.queryByRole("button", { name: "웃겨요 반응 남기기" }),
    ).not.toBeInTheDocument();
  });

  it("names my reaction instead of showing the total", () => {
    // 내 이모지 옆에 총 수가 붙으면 그 반응의 수로 읽힌다. 총 수는 액션 바 요약이 맡는다.
    renderButton({ my_reaction: "love", reaction_count: 12 });

    const button = screen.getByRole("button", { name: "하트 취소" });
    expect(button).toHaveTextContent("하트");
    expect(button).not.toHaveTextContent("12");
  });

  it("offers the default reaction by name before I react", () => {
    renderButton({ reaction_count: 3 });

    const button = screen.getByRole("button", { name: "좋아요 남기기" });
    expect(button).toHaveTextContent("좋아요");
    expect(button).not.toHaveTextContent("3");
  });
});
