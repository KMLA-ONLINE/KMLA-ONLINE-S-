import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createPostComment,
  deletePostComment,
  listPostCommentReplies,
  listPostComments,
} = vi.hoisted(() => ({
  createPostComment: vi.fn(),
  deletePostComment: vi.fn(),
  listPostCommentReplies: vi.fn(),
  listPostComments: vi.fn(),
}));

vi.mock("~/features/posts/data/mutations", async (importActual) => ({
  ...(await importActual<object>()),
  createPostComment,
  deletePostComment,
}));
vi.mock("~/features/posts/data/queries", () => ({
  listPostCommentReplies,
  listPostComments,
}));

import { usePostComments } from "~/features/posts/hooks/use-post-comments";
import type {
  PostComment,
  PostCommentPage,
} from "~/features/posts/model/types";

function comment(overrides: Partial<PostComment> = {}): PostComment {
  return {
    comment_id: "comment-1",
    post_id: "post-id",
    parent_comment_id: null,
    root_comment_id: "comment-1",
    depth: 0,
    body: "본문",
    created_at: "2026-01-01T00:00:00Z",
    is_deleted: false,
    reply_count: 0,
    images: [],
    mentions: [],
    ...overrides,
  } as PostComment;
}

function page(comments: PostComment[] = []): PostCommentPage {
  return { comments, nextCursor: null };
}

describe("usePostComments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts from the post's server comment count", () => {
    const initial = page();
    const { result } = renderHook(() => usePostComments("post-id", initial, 4));

    expect(result.current.commentCount).toBe(4);
  });

  /**
   * 정본 수를 쓰는 이유. 손에 든 값에 `+1` 하면, 다른 사람이 그 사이에 단 댓글이 조용히
   * 지워진 수가 된다. 서버는 트리거 적용 뒤의 수를 돌려주므로 그걸 그대로 쓴다.
   */
  it("applies the canonical count instead of incrementing the stale one", async () => {
    const created = comment({ comment_id: "created" });
    createPostComment.mockResolvedValue({ comment: created, commentCount: 9 });
    const onCountChange = vi.fn();
    const initial = page();

    const { result } = renderHook(() =>
      usePostComments("post-id", initial, 4, onCountChange),
    );

    await act(async () => {
      await result.current.create("새 댓글", "identified", null);
    });

    expect(result.current.commentCount).toBe(9);
    expect(onCountChange).toHaveBeenCalledWith("post-id", 9);
    expect(result.current.comments.map((entry) => entry.comment_id)).toEqual([
      "created",
    ]);
  });

  it("keeps the expanded reply bundle when a reply is created", async () => {
    const root = comment({ comment_id: "root", reply_count: 1 });
    const reply = comment({
      comment_id: "reply",
      parent_comment_id: "root",
      root_comment_id: "root",
      depth: 1,
      created_at: "2026-01-01T01:00:00Z",
    });
    createPostComment.mockResolvedValue({ comment: reply, commentCount: 6 });
    listPostCommentReplies.mockResolvedValue([reply]);
    const initial = page([root]);

    const { result } = renderHook(() => usePostComments("post-id", initial, 5));

    await act(async () => {
      await result.current.create("답글", "identified", "root");
    });

    // 답글은 목록에 섞이지 않고 묶음이 다시 열린 채로 남는다.
    expect(result.current.comments.map((entry) => entry.comment_id)).toEqual([
      "root",
    ]);
    expect(
      result.current.replies.root?.map((entry) => entry.comment_id),
    ).toEqual(["reply"]);
    expect(result.current.expanded.has("root")).toBe(true);
    expect(result.current.commentCount).toBe(6);
  });

  it("lowers the count when a top level comment and its replies are deleted", async () => {
    const root = comment({ comment_id: "root", reply_count: 2 });
    deletePostComment.mockResolvedValue(undefined);
    const onCountChange = vi.fn();
    const initial = page([root]);

    const { result } = renderHook(() =>
      usePostComments("post-id", initial, 5, onCountChange),
    );

    await act(async () => {
      await result.current.remove(root);
    });

    expect(result.current.commentCount).toBe(2);
    expect(result.current.comments).toEqual([]);
    // 삭제도 생성과 똑같이 목록 캐시에 알려야 한다. 한쪽만 알리면 피드가 지운 댓글을 계속 센다.
    expect(onCountChange).toHaveBeenCalledWith("post-id", 2);
  });

  it("reports the lowered count to the list caches when a reply is deleted", async () => {
    const root = comment({ comment_id: "root", reply_count: 2 });
    const kept = comment({
      comment_id: "kept",
      parent_comment_id: "root",
      root_comment_id: "root",
      depth: 1,
    });
    const removed = comment({
      comment_id: "removed",
      parent_comment_id: "root",
      root_comment_id: "root",
      depth: 1,
    });
    deletePostComment.mockResolvedValue(undefined);
    listPostCommentReplies
      .mockResolvedValueOnce([kept, removed])
      .mockResolvedValueOnce([kept]);
    const onCountChange = vi.fn();
    const initial = page([root]);

    const { result } = renderHook(() =>
      usePostComments("post-id", initial, 5, onCountChange),
    );

    await act(async () => {
      await result.current.toggleReplies("root");
    });
    await act(async () => {
      await result.current.remove(removed);
    });

    expect(result.current.commentCount).toBe(4);
    expect(onCountChange).toHaveBeenCalledWith("post-id", 4);
  });

  it("adopts a fresh server count when the loader revalidates", async () => {
    const initial = page();
    const { result, rerender } = renderHook(
      ({ count }: { count: number }) =>
        usePostComments("post-id", initial, count),
      { initialProps: { count: 4 } },
    );

    rerender({ count: 7 });

    await waitFor(() => expect(result.current.commentCount).toBe(7));
  });

  it("surfaces the self-anonymous rejection as a readable message", async () => {
    createPostComment.mockRejectedValue({
      code: "42501",
      message: "post author cannot comment anonymously on own post",
    });
    const initial = page();

    const { result } = renderHook(() => usePostComments("post-id", initial, 4));

    await act(async () => {
      await result.current.create("익명 댓글", "anonymous", null);
    });

    expect(result.current.error).toBe(
      "내가 쓴 게시물에는 익명으로 댓글을 남길 수 없습니다.",
    );
    expect(result.current.commentCount).toBe(4);
  });
});
