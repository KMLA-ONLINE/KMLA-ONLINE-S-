import { act, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listPostPreviews } = vi.hoisted(() => ({
  listPostPreviews: vi.fn(),
}));

vi.mock("~/features/posts/data/queries", () => ({ listPostPreviews }));

import { PostPreviewCard } from "~/features/posts/components/post-preview-card";
import { renderRoute, screen } from "../../../router";

const POST_ID = "6f1c2a4e-8b3d-4c5e-9a7f-0123456789ab";
const PATH = `/groups/band/posts/${POST_ID}`;

function renderCard() {
  return renderRoute(() => <PostPreviewCard postId={POST_ID} path={PATH} />);
}

beforeEach(() => {
  listPostPreviews.mockReset();
});

describe("PostPreviewCard", () => {
  it("links a readable post to its detail", async () => {
    listPostPreviews.mockResolvedValue(
      new Map([
        [
          POST_ID,
          {
            postId: POST_ID,
            kind: "group",
            groupName: "밴드부",
            title: "공연 안내",
            body: "토요일 **7시**",
            authorLabel: "익명",
            authorAvatarUrl: null,
            imageUrl: null,
          },
        ],
      ]),
    );
    renderCard();

    const link = await screen.findByRole("link", { name: /공연 안내/ });
    expect(link).toHaveAttribute("href", PATH);
    expect(link).toHaveTextContent("토요일 7시");
  });

  it("says the post is unavailable when the viewer cannot read it", async () => {
    listPostPreviews.mockResolvedValue(new Map([[POST_ID, null]]));
    renderCard();

    expect(
      await screen.findByText("볼 수 없는 게시물입니다"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("tells a load failure apart from no access and retries on request", async () => {
    listPostPreviews.mockRejectedValueOnce(new Error("network"));
    const { user } = renderCard();

    expect(
      await screen.findByText("게시물을 불러오지 못했습니다"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("볼 수 없는 게시물입니다"),
    ).not.toBeInTheDocument();

    listPostPreviews.mockResolvedValueOnce(new Map([[POST_ID, null]]));
    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(
      await screen.findByText("볼 수 없는 게시물입니다"),
    ).toBeInTheDocument();
  });

  it("shows a staff post under its real author with the staff mark", async () => {
    listPostPreviews.mockResolvedValue(
      new Map([
        [
          POST_ID,
          {
            postId: POST_ID,
            kind: "group",
            groupName: "학생회",
            title: "공지",
            body: "",
            authorIdentity: "staff",
            authorName: "이한별",
            authorLabel: "운영진",
            authorAvatarUrl: null,
            imageUrl: null,
            activityKind: null,
          },
        ],
      ]),
    );
    renderCard();

    const link = await screen.findByRole("link", { name: /공지/ });
    expect(link).toHaveTextContent("이한별");
    expect(link).not.toHaveTextContent("운영진 ·");
    expect(
      screen.getByRole("img", { name: "운영진 명의" }),
    ).toBeInTheDocument();
  });

  it("describes a profile photo change instead of an empty body", async () => {
    listPostPreviews.mockResolvedValue(
      new Map([
        [
          POST_ID,
          {
            postId: POST_ID,
            kind: "profile",
            groupName: null,
            title: null,
            body: "",
            authorIdentity: "identified",
            authorName: "박새벽",
            authorLabel: "박새벽",
            authorAvatarUrl: null,
            imageUrl: "https://signed/avatar",
            activityKind: "avatar_changed",
          },
        ],
      ]),
    );
    renderCard();

    const link = await screen.findByRole("link", {
      name: /프로필 사진을 바꾸었습니다/,
    });
    expect(link).not.toHaveTextContent("게시물 보기");
    // 장식용 사진(alt="")이라 presentation 역할로 찾는다.
    expect(within(link).getByRole("presentation")).toHaveAttribute(
      "src",
      "https://signed/avatar",
    );
  });

  describe("while the room stays open", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("re-checks a mounted card so a deleted post stops looking readable", async () => {
      listPostPreviews
        .mockResolvedValueOnce(
          new Map([
            [
              POST_ID,
              {
                postId: POST_ID,
                kind: "group",
                groupName: "밴드부",
                title: "공연 안내",
                body: "",
                authorIdentity: "identified",
                authorName: "이한별",
                authorLabel: "이한별",
                authorAvatarUrl: null,
                imageUrl: null,
                activityKind: null,
              },
            ],
          ]),
        )
        .mockResolvedValue(new Map([[POST_ID, null]]));
      renderCard();
      expect(
        await screen.findByRole("link", { name: /공연 안내/ }),
      ).toBeInTheDocument();

      await act(() => vi.advanceTimersByTimeAsync(2 * 60_000 + 1_000));

      expect(
        await screen.findByText("볼 수 없는 게시물입니다"),
      ).toBeInTheDocument();
    });
  });
});

describe("PostPreviewCard in English", () => {
  afterEach(() => window.localStorage.clear());

  it("explains an unreadable post in English", async () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    listPostPreviews.mockResolvedValue(new Map([[POST_ID, null]]));
    renderCard();

    expect(
      await screen.findByText("You can't view this post"),
    ).toBeInTheDocument();
  });
});
