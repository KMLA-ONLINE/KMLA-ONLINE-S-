import { describe, expect, it, vi } from "vitest";

import { StoryComposer } from "~/features/stories/components/story-composer";
import { renderRoute, screen } from "../../../router";

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
});
