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

function renderThread(overrides: Partial<ThreadProps> = {}) {
  const props: ThreadProps = {
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
