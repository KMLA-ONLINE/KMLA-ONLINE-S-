import { useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoryViewer } from "~/features/stories/components/story-viewer";
import { createStoryMediaUrls } from "~/features/stories/data/files";
import {
  markStoryViewed,
  sendStoryReaction,
} from "~/features/stories/data/mutations";
import {
  listStoryViewers,
  type StoryItem,
} from "~/features/stories/data/queries";
import { groupStoriesByAuthor } from "~/features/stories/model/story";
import { act, fireEvent, renderRoute, screen } from "../../../router";

vi.mock("~/features/stories/data/mutations", () => ({
  deleteMyStory: vi.fn(),
  markStoryViewed: vi.fn(() => Promise.resolve()),
  sendStoryReaction: vi.fn(() => Promise.resolve()),
  isStoryLimitError: vi.fn(() => false),
}));
vi.mock("~/features/stories/data/queries", () => ({
  listStoryViewers: vi.fn(() =>
    Promise.resolve([
      {
        pubId: "c",
        name: "본 사람",
        avatarUrl: null,
        viewedAt: "2026-10-17T00:10:00Z",
        reactions: ["love", "love", "haha"],
      },
    ]),
  ),
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
    layout: null,
    audience: "everyone",
    publishedAt: "2026-10-17T00:00:00Z",
  };
}

function renderViewer(storyId: number, viewerPubId = "me") {
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
      viewerPubId={viewerPubId}
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

  describe("with a measured card", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("slides the next author in before showing their story", () => {
      vi.useFakeTimers();
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
        390,
      );
      const { onShow } = renderViewer(1);

      swipe({ x: 250, y: 300 }, { x: 120, y: 310 });

      // 터치는 손을 떼면 pointerup 뒤에 pointerleave가 따라온다. 그 때문에 되돌아가면 안 된다.
      fireEvent.pointerLeave(screen.getByTestId("story-gesture-area"), {
        pointerId: 1,
        pointerType: "touch",
      });
      expect(screen.getByTestId("story-track")).toHaveStyle({
        transform: "translateX(-390px)",
      });
      expect(onShow).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(260);
      });
      expect(onShow).toHaveBeenCalledWith(3);
    });

    it("ignores other paging while sliding to the next author", () => {
      vi.useFakeTimers();
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
        390,
      );
      const { onShow } = renderViewer(1);

      swipe({ x: 250, y: 300 }, { x: 120, y: 310 });
      press("ArrowRight");
      fireEvent.click(screen.getByRole("button", { name: "다음 스토리" }));
      act(() => {
        vi.advanceTimersByTime(260);
      });

      expect(onShow.mock.calls).toEqual([[3]]);
    });
  });
});

// Base UI의 dialog 팝업은 방향키의 전파를 막는다. 실제 브라우저처럼 포커스가 있는 팝업에서
// 누른다.
function press(key: string) {
  fireEvent.keyDown(screen.getByRole("dialog"), { key });
}

describe("StoryViewer keyboard", () => {
  it("pages with the arrow keys pressed inside the dialog", () => {
    const { onShow } = renderViewer(1);

    press("ArrowRight");

    expect(onShow).toHaveBeenCalledWith(2);
  });

  it("crosses to the next author and back with the arrow keys", () => {
    const { onShow } = renderViewer(2);

    press("ArrowRight");
    expect(onShow).toHaveBeenLastCalledWith(3);

    // 주소가 따라오기 전에도 방금 넘긴 장 기준으로 돌아간다.
    press("ArrowLeft");
    expect(onShow).toHaveBeenLastCalledWith(2);
  });

  it("keeps the arrow keys for the menu while it is open", async () => {
    const { onShow } = renderViewer(1);

    fireEvent.click(screen.getByRole("button", { name: "스토리 옵션" }));
    await screen.findByRole("menu");
    press("ArrowRight");

    expect(onShow).not.toHaveBeenCalled();
  });
});

describe("StoryViewer last story", () => {
  afterEach(() => {
    // @ts-expect-error -- jsdom에는 원래 없던 것을 지운다.
    delete Element.prototype.animate;
  });

  it("closes on the right arrow key", () => {
    const { onShow, onClose } = renderViewer(3);

    press("ArrowRight");

    expect(onClose).toHaveBeenCalled();
    expect(onShow).not.toHaveBeenCalled();
  });

  it("closes only once while the key repeats", () => {
    const { onClose } = renderViewer(3);

    press("ArrowRight");
    press("ArrowRight");
    swipe({ x: 200, y: 300 }, { x: 200, y: 300 });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a tap to the next side", () => {
    const { onShow, onClose } = renderViewer(3);

    swipe({ x: 200, y: 300 }, { x: 200, y: 300 });

    expect(onClose).toHaveBeenCalled();
    expect(onShow).not.toHaveBeenCalled();
  });

  it("closes from the desktop next button", () => {
    const { onClose } = renderViewer(3);

    expect(
      screen.queryByRole("button", { name: "다음 스토리" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "스토리 닫기" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the progress bar finishes", () => {
    const calls = stubAnimations();
    const { onClose } = renderViewer(3);
    const progress = calls.find(({ keyframes }) =>
      keyframes.some((frame) => String(frame.transform).includes("scaleX")),
    )?.animation as { onfinish: (() => void) | null };

    act(() => {
      progress.onfinish?.();
    });

    expect(onClose).toHaveBeenCalled();
  });

  it("still advances when an earlier progress bar finishes", () => {
    const calls = stubAnimations();
    const { onShow, onClose } = renderViewer(1);
    const progress = calls.find(({ keyframes }) =>
      keyframes.some((frame) => String(frame.transform).includes("scaleX")),
    )?.animation as { onfinish: (() => void) | null };

    act(() => {
      progress.onfinish?.();
    });

    expect(onShow).toHaveBeenCalledWith(2);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("StoryViewer engagement", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("records someone else's story as seen and sends a reaction per press", () => {
    renderViewer(1);

    expect(markStoryViewed).toHaveBeenCalledWith(1);
    // 본 사람은 작성자만 본다.
    expect(
      screen.queryByRole("button", { name: /읽은 사람/ }),
    ).not.toBeInTheDocument();
    expect(listStoryViewers).not.toHaveBeenCalled();

    const love = screen.getByRole("button", { name: "하트 보내기" });
    fireEvent.click(love);
    fireEvent.click(love);

    expect(sendStoryReaction).toHaveBeenCalledTimes(2);
    expect(sendStoryReaction).toHaveBeenCalledWith(1, "love");
  });

  it("shows the author who saw the story and what they sent", async () => {
    renderViewer(1, "a");

    expect(markStoryViewed).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "하트 보내기" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: "읽은 사람 1명" }),
    );

    expect(listStoryViewers).toHaveBeenCalledWith(1);
    const viewer = await screen.findByRole("listitem");
    expect(viewer).toHaveTextContent("본 사람");
    expect(viewer).toHaveAccessibleDescription("하트 2, 웃겨요 1");
  });

  it("opens who saw the story when the author swipes up", async () => {
    const { onClose } = renderViewer(1, "a");

    swipe({ x: 200, y: 500 }, { x: 200, y: 340 });

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByRole("listitem")).toHaveTextContent("본 사람");
  });

  it("closes the list when pulled down from its top", async () => {
    const { onClose } = renderViewer(1, "a");

    fireEvent.click(
      await screen.findByRole("button", { name: "읽은 사람 1명" }),
    );
    const list = await screen.findByRole("list");
    const touch = { identifier: 1, clientX: 100 };

    fireEvent.touchStart(list, { touches: [{ ...touch, clientY: 100 }] });
    fireEvent.touchMove(list, { touches: [{ ...touch, clientY: 160 }] });
    fireEvent.touchMove(list, { touches: [{ ...touch, clientY: 260 }] });
    fireEvent.touchEnd(list);

    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the list open after visiting a viewer's profile", async () => {
    function Profile() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate(-1)}>
          뒤로
        </button>
      );
    }
    const groups = groupStoriesByAuthor([textStory(1, "a")], "a");
    renderRoute(
      () => (
        <StoryViewer
          groups={groups}
          storyId={1}
          viewerPubId="a"
          onShow={vi.fn()}
          onClose={vi.fn()}
          onDeleted={vi.fn()}
        />
      ),
      { routes: [{ path: "/profile/:pubId", Component: Profile }] },
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "읽은 사람 1명" }),
    );
    fireEvent.click(await screen.findByRole("link", { name: /본 사람/ }));
    fireEvent.click(await screen.findByRole("button", { name: "뒤로" }));

    expect(await screen.findByRole("listitem")).toHaveTextContent("본 사람");
  });

  it("closes only the list on Escape and returns focus to the trigger", async () => {
    const { onClose } = renderViewer(1, "a");

    const trigger = await screen.findByRole("button", {
      name: "읽은 사람 1명",
    });
    fireEvent.click(trigger);
    const close = await screen.findByRole("button", { name: "읽은 사람 닫기" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: "Escape" });

    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });
});

/** jsdom에는 Web Animations가 없다. 부를 때마다 멈춤·재생을 기록하는 가짜를 돌려준다. */
function stubAnimations() {
  const calls: { keyframes: Keyframe[]; animation: Record<string, unknown> }[] =
    [];
  const animate = vi.fn((keyframes: Keyframe[]) => {
    const animation = {
      playState: "running",
      currentTime: 0,
      onfinish: null,
      pause: vi.fn(),
      play: vi.fn(),
      cancel: vi.fn(),
    };
    calls.push({ keyframes, animation });
    return animation;
  });
  Object.defineProperty(Element.prototype, "animate", {
    value: animate,
    configurable: true,
    writable: true,
  });
  return calls;
}

describe("StoryViewer reacting", () => {
  afterEach(() => {
    // @ts-expect-error -- jsdom에는 원래 없던 것을 지운다.
    delete Element.prototype.animate;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("holds the story while reactions are being sent", () => {
    vi.useFakeTimers();
    const calls = stubAnimations();
    renderViewer(1);
    const progress = calls.find(({ keyframes }) =>
      keyframes.some((frame) => String(frame.transform).includes("scaleX")),
    )?.animation as {
      pause: ReturnType<typeof vi.fn>;
      play: ReturnType<typeof vi.fn>;
    };
    const love = screen.getByRole("button", { name: "하트 보내기" });

    progress.play.mockClear();
    progress.pause.mockClear();
    fireEvent.pointerDown(love);
    fireEvent.pointerUp(love);
    fireEvent.click(love);

    expect(progress.pause).toHaveBeenCalled();
    expect(progress.play).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(progress.play).toHaveBeenCalled();
  });

  it("lets the story go on when a press is dragged off the reactions", () => {
    vi.useFakeTimers();
    const calls = stubAnimations();
    renderViewer(1);
    const progress = calls.find(({ keyframes }) =>
      keyframes.some((frame) => String(frame.transform).includes("scaleX")),
    )?.animation as { play: ReturnType<typeof vi.fn> };
    const love = screen.getByRole("button", { name: "하트 보내기" });

    // 마우스로 누른 채 밖으로 끌어 놓으면 이 줄에는 pointerup도 click도 오지 않는다.
    fireEvent.pointerDown(love);
    progress.play.mockClear();
    fireEvent.pointerLeave(love);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(progress.play).toHaveBeenCalled();
  });
});

describe("StoryViewer view marking", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function renderPhotoStory() {
    const photo: StoryItem = {
      ...textStory(1, "a"),
      content: "사진 스토리",
      background: null,
      imagePath: "a/photo",
    };
    vi.mocked(createStoryMediaUrls).mockResolvedValue(
      new Map([["a/photo", "https://example.test/photo"]]),
    );
    renderRoute(() => (
      <StoryViewer
        groups={groupStoriesByAuthor([photo], "me")}
        storyId={1}
        viewerPubId="me"
        onShow={vi.fn()}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />
    ));
  }

  it("records a photo story only once the photo is on screen", async () => {
    renderPhotoStory();

    const image = await screen.findByRole("img", { name: "사진 스토리" });
    expect(markStoryViewed).not.toHaveBeenCalled();

    fireEvent.load(image);

    expect(markStoryViewed).toHaveBeenCalledWith(1);
  });
});
