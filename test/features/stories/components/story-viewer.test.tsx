import { describe, expect, it, vi } from "vitest";

import { StoryViewer } from "~/features/stories/components/story-viewer";
import type { StoryItem } from "~/features/stories/data/queries";
import { groupStoriesByAuthor } from "~/features/stories/model/story";
import { fireEvent, renderRoute, screen } from "../../../router";

vi.mock("~/features/stories/data/mutations", () => ({
  deleteMyStory: vi.fn(),
}));
vi.mock("~/features/stories/data/files", () => ({
  createStoryMediaUrls: vi.fn(() => Promise.resolve(new Map())),
}));

function textStory(id: number, pubId: string): StoryItem {
  return {
    id,
    pubId,
    name: pubId,
    avatarUrl: null,
    content: `스토리 ${id}`,
    background: "blue",
    imagePath: null,
    thumbnailUrl: null,
    linkUrl: null,
    publishedAt: "2026-10-17T00:00:00Z",
  };
}

function renderViewer(storyId: number) {
  const onShow = vi.fn();
  const onClose = vi.fn();
  const groups = groupStoriesByAuthor(
    [textStory(1, "a"), textStory(2, "a"), textStory(3, "b")],
    "me",
  );
  renderRoute(() => (
    <StoryViewer
      groups={groups}
      storyId={storyId}
      viewerPubId="me"
      onShow={onShow}
      onClose={onClose}
      onDeleted={vi.fn()}
    />
  ));
  return { onShow, onClose };
}

function swipe(from: { x: number; y: number }, to: { x: number; y: number }) {
  const area = screen.getByTestId("story-gesture-area");
  const init = { pointerId: 1, pointerType: "touch", button: 0 };

  fireEvent.pointerDown(area, { ...init, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(area, { ...init, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(area, { ...init, clientX: to.x, clientY: to.y });
}

describe("StoryViewer gestures", () => {
  it("pages within the author on a tap", () => {
    const { onShow } = renderViewer(1);

    swipe({ x: 200, y: 300 }, { x: 200, y: 300 });

    expect(onShow).toHaveBeenCalledWith(2);
  });

  it("skips to the next author's first story on a quick left swipe", () => {
    const { onShow } = renderViewer(1);

    swipe({ x: 250, y: 300 }, { x: 120, y: 310 });

    expect(onShow).toHaveBeenCalledWith(3);
  });

  it("closes when swiping past the last author", () => {
    const { onShow, onClose } = renderViewer(3);

    swipe({ x: 250, y: 300 }, { x: 120, y: 310 });

    expect(onClose).toHaveBeenCalled();
    expect(onShow).not.toHaveBeenCalled();
  });
});
