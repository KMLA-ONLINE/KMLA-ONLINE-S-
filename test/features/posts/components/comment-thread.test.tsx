import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import { CommentThread } from "~/features/posts/components/comment-thread";
import { postComment } from "../post-comment-fixture";
import { renderRoute, screen, within } from "../../../router";

type ThreadProps = Parameters<typeof CommentThread>[0];

const root = postComment({
  comment_id: "root-id",
  root_comment_id: "root-id",
  body: "최상위 댓글",
  reply_count: 2,
});

const firstReply = postComment({
  comment_id: "reply-1",
  root_comment_id: "root-id",
  parent_comment_id: "root-id",
  parent_author_label: "이한별",
  depth: 1,
  body: "1단계 답글",
});

const deepReply = postComment({
  comment_id: "reply-2",
  root_comment_id: "root-id",
  parent_comment_id: "reply-1",
  parent_author_label: "이한별",
  depth: 4,
  body: "4단계 답글",
});

function threadProps(overrides: Partial<ThreadProps> = {}): ThreadProps {
  return {
    comments: [root],
    replies: {},
    expanded: new Set<string>(),
    hasMore: false,
    loading: false,
    pending: false,
    viewer: { name: "홍길동", avatarUrl: null },
    onReact: vi.fn(),
    onLoadMore: vi.fn(),
    onToggleReplies: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

function renderThread(overrides: Partial<ThreadProps> = {}) {
  const props = threadProps(overrides);
  return { ...renderRoute(() => <CommentThread {...props} />), props };
}

describe("CommentThread", () => {
  it("invites the first comment when the thread is empty", () => {
    renderThread({ comments: [] });

    expect(screen.getByText("아직 댓글이 없습니다")).toBeInTheDocument();
  });

  it("keeps the reply bundle collapsed until it is asked for", async () => {
    const onToggleReplies = vi.fn();
    const { user } = renderThread({ onToggleReplies });

    const toggle = screen.getByRole("button", { name: "답글 2개 보기" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(onToggleReplies).toHaveBeenCalledWith("root-id");
  });

  it("labels the toggle for collapsing once the bundle is open", () => {
    renderThread({
      replies: { "root-id": [firstReply] },
      expanded: new Set(["root-id"]),
    });

    expect(
      screen.getByRole("button", { name: "답글 숨기기" }),
    ).toBeInTheDocument();
  });

  it("flattens replies past the second level instead of indenting further", () => {
    renderThread({
      replies: { "root-id": [firstReply, deepReply] },
      expanded: new Set(["root-id"]),
    });

    // 깊이가 달라도 한 묶음에 나란히 놓이고, 부모는 본문 앞 칩이 밝힌다.
    const bundle = screen.getByRole("list", { name: "답글" });
    expect(within(bundle).getByText("1단계 답글")).toBeInTheDocument();
    expect(within(bundle).getByText("4단계 답글")).toBeInTheDocument();
    expect(
      within(bundle).getAllByRole("button", { name: "@이한별" }),
    ).toHaveLength(2);
  });

  it("offers more comments below the list", async () => {
    const onLoadMore = vi.fn();
    const { user } = renderThread({ hasMore: true, onLoadMore });

    await user.click(screen.getByRole("button", { name: "댓글 더 보기" }));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it("selects the comment being replied to", async () => {
    const onReply = vi.fn();
    const { user } = renderThread({
      replies: { "root-id": [firstReply] },
      expanded: new Set(["root-id"]),
      onReply,
    });

    await user.click(screen.getAllByRole("button", { name: "답글" })[0]);

    expect(onReply).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: "root-id" }),
    );
  });

  // 표시가 타이머로 꺼지던 시절에는 긴 답글을 쓰는 도중 대상이 화면에서 사라졌다. 이제는
  // `replyingToId`만 보므로, 답글 모드가 끝나기 전에는 얼마가 지나도 남아 있어야 한다.
  it("marks the reply target for as long as the reply is being written", () => {
    renderThread({
      replies: { "root-id": [firstReply] },
      expanded: new Set(["root-id"]),
      replyingToId: "root-id",
    });

    expect(screen.getByText("최상위 댓글").closest("[id]")).toHaveClass(
      "bg-primary/5",
    );
    expect(screen.getByText("1단계 답글").closest("[id]")).not.toHaveClass(
      "bg-primary/5",
    );
  });

  it("drops the mark once the reply mode ends", () => {
    renderThread({ replyingToId: null });

    expect(screen.getByText("최상위 댓글").closest("[id]")).not.toHaveClass(
      "bg-primary/5",
    );
  });

  it("marks the comment the post author wrote", () => {
    renderThread({ postAuthorPubId: "hanbyeol-25" });

    expect(screen.getByText("작성자")).toBeInTheDocument();
  });

  it("leaves another member's comment unmarked", () => {
    renderThread({ postAuthorPubId: "someone-else" });

    expect(screen.queryByText("작성자")).not.toBeInTheDocument();
  });

  /**
   * 익명 댓글과 익명 게시물은 둘 다 `author_pub_id`가 비어서 내려온다. 비교만 하면 두 빈
   * 값이 맞아떨어져 아무 익명 댓글에나 작성자 표시가 붙는다 — 익명이 통째로 벗겨진다.
   * (익명 게시물의 글쓴이는 서버가 `글쓴이` 라벨로 따로 밝힌다.)
   */
  it("never marks an anonymous comment on an anonymous post", () => {
    renderThread({
      comments: [
        postComment({
          author_identity: "anonymous",
          author_label: "익명2",
          author_name: null as unknown as string,
          author_pub_id: null as unknown as string,
        }),
      ],
      postAuthorPubId: null,
    });

    expect(screen.queryByText("작성자")).not.toBeInTheDocument();
  });

  /**
   * 회귀: `scrollIntoView`는 스크롤 조상을 전부 훑고 모바일에서는 visual viewport까지
   * 밀어서, 부모 댓글로 옮겨 왔을 뿐인데 댓글 시트가 통째로 끌려왔다.
   */
  it("moves to the parent inside the comment container only", async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const scrollRef: RefObject<HTMLElement | null> = { current: null };
    const props = threadProps({
      replies: { "root-id": [firstReply] },
      expanded: new Set(["root-id"]),
      scrollRef,
    });

    const { user } = renderRoute(() => (
      <div
        ref={(node) => {
          scrollRef.current = node;
        }}
      >
        <CommentThread {...props} />
      </div>
    ));

    // 이동의 결과는 부모 댓글과, 목록이 벗어나지 말아야 할 컨테이너 사이의 관계다.
    const container = scrollRef.current;
    const target = document.getElementById("comment-root-id");
    expect(container).not.toBeNull();
    expect(target).not.toBeNull();
    if (!container || !target) return;

    container.scrollTop = 100;
    const scrollTo = vi.spyOn(container, "scrollTo");
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 0,
      height: 300,
    } as DOMRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 260,
      height: 90,
    } as DOMRect);

    await user.click(screen.getByRole("button", { name: "@이한별" }));

    // 260 − (300 − 90) / 2 = 155만큼 더 내려가면 부모가 가운데에 온다.
    expect(scrollTo).toHaveBeenCalledWith({ top: 255, behavior: "smooth" });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not offer a reply on a comment at the deepest level", () => {
    renderThread({
      replies: {
        "root-id": [postComment({ comment_id: "deepest", depth: 10 })],
      },
      expanded: new Set(["root-id"]),
    });

    // 최상위 댓글에는 답글 버튼이 남아 있고, 10단계 답글에는 없다.
    expect(screen.getAllByRole("button", { name: "답글" })).toHaveLength(1);
  });
});
