import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocation, useNavigate } from "react-router";

import { StoryRail } from "~/features/stories/components/story-rail";
import type { StoryItem } from "~/features/stories/data/queries";
import { act, fireEvent, renderRoute, screen, waitFor } from "../../../router";

const mutations = vi.hoisted(() => ({
  createTextStory: vi.fn(),
  deleteMyStory: vi.fn(),
  isStoryLimitError: () => false,
}));
vi.mock("~/features/stories/data/mutations", () => mutations);
vi.mock("~/features/stories/data/queries", () => ({
  listActiveStories: vi.fn(() => Promise.resolve([])),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("~/features/stories/data/files", () => ({
  createImageStory: vi.fn(),
  createStoryMediaUrls: vi.fn(() => Promise.resolve(new Map())),
}));

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <output data-testid="location">{location.search}</output>
      <button type="button" onClick={() => void navigate(-1)}>
        브라우저 뒤로
      </button>
    </>
  );
}

function deferUpload() {
  let resolve: () => void = () => undefined;
  let reject: (cause: Error) => void = () => undefined;
  mutations.createTextStory.mockReturnValueOnce(
    new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    }),
  );
  return {
    resolve: () => resolve(),
    reject: () => reject(new Error("offline")),
  };
}

async function typeTextStory(user: ReturnType<typeof renderComposer>["user"]) {
  await user.click(screen.getByRole("radio", { name: "글" }));
  await user.type(screen.getByRole("textbox", { name: "글" }), "오늘의 이야기");
}

function renderComposer(
  initialEntries: NonNullable<
    Parameters<typeof renderRoute>[1]
  >["initialEntries"] = ["/?story=new"],
) {
  return renderRoute(
    () => (
      <>
        <StoryRail
          initialItems={[]}
          viewer={{ pubId: "me", name: "나", avatarUrl: null }}
          canWrite
        />
        <LocationProbe />
      </>
    ),
    { initialEntries },
  );
}

describe("StoryRail composer", () => {
  it("keeps the composer open when Escape arrives right after sharing starts", async () => {
    const upload = deferUpload();
    const { user } = renderComposer();
    await typeTextStory(user);

    // 공유를 누른 직후, 부모가 다시 그려지기 전에 Esc가 들어오는 경합을 한 act 안에서 재현한다.
    // 이벤트마다 act를 따로 두면 그 사이에 effect가 돌아 경합이 사라진다. 임의의 지연으로 순서를
    // 맞추지 않는다.
    // eslint-disable-next-line testing-library/no-unnecessary-act -- 위 이유로 두 이벤트를 한 act에 묶는다.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "공유" }));
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
    });

    expect(screen.getByRole("dialog", { name: "스토리 만들기" })).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("?story=new");
    expect(screen.getByRole("button", { name: "올리는 중" })).toBeDisabled();

    upload.resolve();

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(/^$/),
    );
  });

  it("refuses the close button while uploading and allows closing after a failure", async () => {
    const upload = deferUpload();
    const { user } = renderComposer();
    await typeTextStory(user);
    await user.click(screen.getByRole("button", { name: "공유" }));
    await user.click(screen.getByRole("button", { name: "닫기" }));

    expect(screen.getByTestId("location")).toHaveTextContent("?story=new");

    upload.reject();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "스토리를 올리지 못했습니다",
    );
    await user.click(screen.getByRole("button", { name: "닫기" }));

    expect(screen.getByTestId("location")).toHaveTextContent(/^$/);
  });

  it("tells the user the story was shared after leaving the composer with browser back", async () => {
    const upload = deferUpload();
    const { user } = renderComposer([
      "/",
      {
        pathname: "/",
        search: "?story=new",
        state: { storyOverlayPushed: true },
      },
    ]);
    await typeTextStory(user);
    await user.click(screen.getByRole("button", { name: "공유" }));
    // 모달이 바깥을 가리므로 사용자 클릭이 아니라 브라우저 뒤로가기를 흉내 내 직접 누른다.
    fireEvent.click(
      screen.getByRole("button", { name: "브라우저 뒤로", hidden: true }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    upload.resolve();

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("스토리를 올렸습니다."),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(/^$/);
  });
});

function textStory(id: number, pubId: string): StoryItem {
  return {
    id,
    pubId,
    name: `작성자 ${pubId}`,
    avatarUrl: null,
    content: `스토리 ${id}`,
    background: "blue",
    imagePath: null,
    thumbnailUrl: null,
    linkUrl: null,
    publishedAt: "2026-10-17T00:00:00Z",
  };
}

function renderRail() {
  return renderRoute(() => (
    <>
      <StoryRail
        initialItems={[textStory(1, "a"), textStory(2, "a"), textStory(3, "b")]}
        viewer={{ pubId: "me", name: "나", avatarUrl: null }}
        canWrite={false}
      />
      <LocationProbe />
    </>
  ));
}

describe("StoryRail cards", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cycles an author's card every five seconds and opens the story it shows", () => {
    vi.useFakeTimers();
    renderRail();
    const card = screen.getByRole("button", { name: /작성자 a 스토리 2개/ });

    expect(card).toHaveTextContent("스토리 1");

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(card).toHaveTextContent("스토리 2");

    fireEvent.click(card);
    expect(screen.getByTestId("location")).toHaveTextContent("?story=2");
  });

  it("holds the card still while the pointer rests on it", () => {
    vi.useFakeTimers();
    renderRail();
    const card = screen.getByRole("button", { name: /작성자 a 스토리 2개/ });

    fireEvent.pointerEnter(card, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(card).toHaveTextContent("스토리 1");

    fireEvent.pointerLeave(card, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(card).toHaveTextContent("스토리 2");
  });
});
