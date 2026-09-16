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

  /**
   * 최상위를 지우면 답글 묶음이 통째로 사라지고, 자식이 없어진 자리 표시는 조상까지 데려간다.
   * 손에 든 값에서 "1 + reply_count"를 빼면 그 규칙을 클라이언트가 한 벌 더 적는 셈이고, 두
   * 벌은 언젠가 갈라진다. 여기서는 그 뺄셈으로는 나올 수 없는 수를 서버가 돌려준다.
   */
  it("takes the deletion count from the server instead of subtracting", async () => {
    const root = comment({ comment_id: "root", reply_count: 2 });
    deletePostComment.mockResolvedValue(1);
    const onCountChange = vi.fn();
    const initial = page([root]);

    const { result } = renderHook(() =>
      usePostComments("post-id", initial, 5, onCountChange),
    );

    await act(async () => {
      await result.current.remove(root);
    });

    // 상대 계산이었다면 5 - (1 + 2) = 2가 됐을 자리다.
    expect(result.current.commentCount).toBe(1);
    expect(result.current.comments).toEqual([]);
    // 삭제도 생성과 똑같이 목록 캐시에 알려야 한다. 한쪽만 알리면 피드가 지운 댓글을 계속 센다.
    expect(onCountChange).toHaveBeenCalledWith("post-id", 1);
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
    // 지운 답글 하나로 끝나지 않고 자리 표시만 남아 있던 조상까지 함께 사라진 경우.
    deletePostComment.mockResolvedValue(3);
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

    // 사라진 답글 수만 세었다면 5 - 1 = 4가 됐을 자리다.
    expect(result.current.commentCount).toBe(3);
    expect(onCountChange).toHaveBeenCalledWith("post-id", 3);
    // 묶음은 여전히 다시 읽는다 — tombstone 규칙은 서버만 안다.
    expect(
      result.current.replies.root?.map((entry) => entry.comment_id),
    ).toEqual(["kept"]);
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
