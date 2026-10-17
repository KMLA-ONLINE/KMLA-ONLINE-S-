import { describe, expect, it, vi } from "vitest";

import { StoryComposer } from "~/features/stories/components/story-composer";
import { fireEvent, renderRoute, screen } from "../../../router";

const data = vi.hoisted(() => ({
  createTextStory: vi.fn(),
  isStoryLimitError: () => false,
}));
vi.mock("~/features/stories/data/mutations", () => data);

describe("StoryComposer", () => {
  it("names the failed story upload, preserves the draft and allows another attempt", async () => {
    data.createTextStory.mockRejectedValueOnce(new Error("offline"));
    const onDone = vi.fn();
    const { user } = renderRoute(() => <StoryComposer onDone={onDone} />);
    await user.click(screen.getByRole("radio", { name: "글" }));
    await user.type(
      screen.getByRole("textbox", { name: "글" }),
      "오늘의 이야기",
    );
    await user.click(screen.getByRole("button", { name: "공유" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "스토리를 올리지 못했습니다. 다시 시도해 주세요.",
    );
    expect(screen.getByRole("textbox", { name: "글" })).toHaveValue(
      "오늘의 이야기",
    );
    expect(screen.getByRole("button", { name: "공유" })).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("saves where the text was moved and how large it was made", async () => {
    data.createTextStory.mockResolvedValueOnce(undefined);
    const { user } = renderRoute(() => <StoryComposer onDone={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: "글" }));
    await user.type(
      screen.getByRole("textbox", { name: "글" }),
      "오늘의 이야기",
    );

    // 방향키 한 번이 캔버스의 2%를 옮긴다. 포인터 없이도 자리를 고를 수 있어야 한다.
    await user.click(screen.getByRole("button", { name: /글 옮기기/ }));
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowLeft}");
    fireEvent.change(screen.getByRole("slider", { name: "글 크기" }), {
      target: { value: "1.5" },
    });
    await user.click(screen.getByRole("button", { name: "공유" }));

    expect(data.createTextStory).toHaveBeenCalledWith(
      expect.objectContaining({
        layout: { text: { x: 0.48, y: 0.46, scale: 1.5 } },
      }),
    );
  });

  it("moves the link by dragging it and resizes it with two fingers", async () => {
    data.createTextStory.mockResolvedValueOnce(undefined);
    // jsdom은 레이아웃이 없어 캔버스 크기를 정해 준다. 폭 300px이면 30px이 캔버스의 10%다.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 500 }),
    );
    const { user } = renderRoute(() => <StoryComposer onDone={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: "글" }));
    await user.type(screen.getByRole("textbox", { name: "글" }), "공지");
    await user.type(screen.getByRole("textbox", { name: /링크/ }), "kmla.kr");
    const pill = screen.getByRole("button", { name: /링크 옮기기/ });
    const touch = (pointerId: number, clientX: number, clientY: number) => ({
      pointerId,
      pointerType: "touch",
      clientX,
      clientY,
    });

    fireEvent.pointerDown(pill, touch(1, 150, 440));
    fireEvent.pointerMove(pill, touch(1, 120, 390));
    // 두 번째 손가락이 들어오면 끌기를 멈추고, 손가락 사이가 두 배로 벌어지면 두 배가 된다.
    fireEvent.pointerDown(pill, touch(2, 170, 390));
    fireEvent.pointerMove(pill, touch(2, 220, 390));
    fireEvent.pointerUp(pill, touch(2, 220, 390));
    fireEvent.pointerUp(pill, touch(1, 120, 390));
    await user.click(screen.getByRole("button", { name: "공유" }));

    expect(data.createTextStory).toHaveBeenCalledWith(
      expect.objectContaining({
        layout: {
          text: { x: 0.5, y: 0.5, scale: 1 },
          link: { x: 0.4, y: 0.78, scale: 2 },
        },
      }),
    );
  });
});
