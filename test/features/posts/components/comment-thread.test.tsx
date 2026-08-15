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
    hasOlder: false,
    loading: false,
    pending: false,
    viewer: { name: "홍길동", avatarUrl: null },
    identities: ["identified"],
    identity: "identified",
    onIdentityChange: vi.fn(),
    onReact: vi.fn(),
    onLoadOlder: vi.fn(),
    onToggleReplies: vi.fn(),
    onSubmitReply: vi.fn().mockResolvedValue(postComment()),
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
    const bundle = screen.getByRole("list", { name: "" });
    expect(within(bundle).getByText("1단계 답글")).toBeInTheDocument();
    expect(within(bundle).getByText("4단계 답글")).toBeInTheDocument();
    expect(
      within(bundle).getAllByRole("button", { name: "@이한별" }),
    ).toHaveLength(2);
  });

  it("offers older comments above the list", async () => {
    const onLoadOlder = vi.fn();
    const { user } = renderThread({ hasOlder: true, onLoadOlder });

    await user.click(screen.getByRole("button", { name: "이전 댓글 더 보기" }));
    expect(onLoadOlder).toHaveBeenCalled();
  });

  it("opens an inline composer under the comment being replied to", async () => {
    const onSubmitReply = vi.fn().mockResolvedValue(postComment());
    const { user } = renderThread({
      replies: { "root-id": [firstReply] },
      expanded: new Set(["root-id"]),
      onSubmitReply,
    });

    await user.click(screen.getAllByRole("button", { name: "답글" })[0]);

    const input =
      await screen.findByPlaceholderText("이한별님에게 답글 남기기…");
    await user.type(input, "답글 본문{Enter}");

    expect(onSubmitReply).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: "root-id" }),
      "답글 본문",
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
