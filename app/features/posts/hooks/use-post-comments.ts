import { useState } from "react";

import {
  clearCommentReaction,
  createCommentImageUploadSession,
  createPostComment,
  deletePostComment,
  setCommentReaction,
  updatePostComment,
} from "~/features/posts/data/mutations";
import {
  listPostCommentReplies,
  listPostComments,
} from "~/features/posts/data/queries";
import { getCommentErrorMessage } from "~/features/posts/model/format";
import { applyReactionLocally } from "~/features/posts/model/reactions";
import type {
  PostComment,
  CommentImageInput,
  PostCommentPage,
  PostIdentity,
  PostReaction,
  ReactionSummary,
} from "~/features/posts/model/types";

function liveCount(replies: PostComment[]): number {
  return replies.filter((reply) => !reply.is_deleted).length;
}

function mergeComments(
  current: PostComment[],
  incoming: PostComment[],
): PostComment[] {
  const merged = new Map(
    current.map((comment) => [comment.comment_id, comment]),
  );
  for (const comment of incoming) merged.set(comment.comment_id, comment);
  return [...merged.values()].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.comment_id.localeCompare(right.comment_id),
  );
}

/**
 * 게시물 상세의 댓글 상태.
 *
 * 뮤테이션 뒤에 route를 재검증하지 않는다. 재검증하면 사용자가 펼쳐 둔 답글 묶음과 위로 불러온
 * 이전 페이지가 통째로 초기화된다. 대신 RPC가 돌려준 정본 행을 목록에 병합한다.
 *
 * 답글은 만들거나 지운 뒤 그 묶음만 다시 불러온다. tombstone이 보이는지 여부는 "살아 있는
 * 자손이 있는가"라는 서버 규칙이라, 클라이언트에서 흉내 내면 두 규칙이 갈라진다.
 */
export function usePostComments(postId: string, initialPage: PostCommentPage) {
  const [imageSession] = useState(createCommentImageUploadSession);
  const [comments, setComments] = useState(initialPage.comments);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [replies, setReplies] = useState<Record<string, PostComment[]>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [countDelta, setCountDelta] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedPage, setLoadedPage] = useState(initialPage);

  // loader가 새 페이지를 내려주면(게시물 이동, 재검증) 로컬 상태를 버리고 다시 시작한다.
  if (loadedPage !== initialPage) {
    setLoadedPage(initialPage);
    setComments(initialPage.comments);
    setNextCursor(initialPage.nextCursor);
    setReplies({});
    setExpanded(new Set());
    setCountDelta(0);
    setError(null);
  }

  const run = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await action();
    } catch (cause) {
      setError(getCommentErrorMessage(cause));
      return undefined;
    } finally {
      setPending(false);
    }
  };

  const refreshBundle = async (rootId: string) => {
    const bundle = await listPostCommentReplies(rootId);
    setReplies((current) => ({ ...current, [rootId]: bundle }));
    setComments((current) =>
      current.map((item) =>
        item.comment_id === rootId
          ? { ...item, reply_count: liveCount(bundle) }
          : item,
      ),
    );
    return bundle;
  };

  const loadMore = async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await listPostComments(postId, nextCursor);
      setComments((current) => mergeComments(current, page.comments));
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(getCommentErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  const toggleReplies = async (rootId: string) => {
    const next = new Set(expanded);
    if (next.has(rootId)) {
      next.delete(rootId);
      setExpanded(next);
      return;
    }
    next.add(rootId);
    setExpanded(next);
    if (replies[rootId]) return;
    await run(() => refreshBundle(rootId));
  };

  const create = (
    body: string,
    identity: PostIdentity,
    parentCommentId: string | null,
    image?: CommentImageInput,
  ) =>
    run(async () => {
      const created = await createPostComment(
        postId,
        body,
        identity,
        parentCommentId,
        image,
        imageSession,
      );
      setCountDelta((current) => current + 1);
      if (created.depth === 0) {
        setComments((current) => mergeComments(current, [created]));
        return created;
      }
      await refreshBundle(created.root_comment_id);
      setExpanded((current) => new Set(current).add(created.root_comment_id));
      return created;
    });

  const edit = (
    comment: PostComment,
    body: string,
    image?: CommentImageInput,
  ) =>
    run(async () => {
      const updated = await updatePostComment(
        comment.comment_id,
        body,
        comment.post_id,
        image,
        imageSession,
      );
      const replace = (item: PostComment) =>
        item.comment_id === updated.comment_id
          ? { ...updated, reply_count: item.reply_count }
          : item;
      if (updated.depth === 0) {
        setComments((current) => current.map(replace));
      } else {
        setReplies((current) => ({
          ...current,
          [updated.root_comment_id]: (
            current[updated.root_comment_id] ?? []
          ).map(replace),
        }));
      }
      return updated;
    });

  const remove = (comment: PostComment) =>
    run(async () => {
      await deletePostComment(comment.comment_id);
      if (comment.depth === 0) {
        // 최상위를 지우면 답글 묶음까지 함께 사라진다(기능 명세 §9.4).
        setCountDelta((current) => current - (1 + comment.reply_count));
        setComments((current) =>
          current.filter((item) => item.comment_id !== comment.comment_id),
        );
        setReplies((current) => {
          const next = { ...current };
          delete next[comment.comment_id];
          return next;
        });
        setExpanded((current) => {
          const next = new Set(current);
          next.delete(comment.comment_id);
          return next;
        });
        return;
      }
      const before = liveCount(replies[comment.root_comment_id] ?? []);
      const bundle = await refreshBundle(comment.root_comment_id);
      setCountDelta((current) => current - (before - liveCount(bundle)));
    });

  /**
   * 댓글 반응 (기능 명세 §10.2). 게시물 반응과 같은 이유로 화면이 먼저 움직이고 정본이 덮는다.
   *
   * `run`을 쓰지 않는다 — 반응은 실패해도 되돌리면 그만이라 입력창까지 잠글 일이 아니다.
   */
  const react = (comment: PostComment, next: PostReaction | null) => {
    const merge = (summary: ReactionSummary) => {
      const patch = (item: PostComment) =>
        item.comment_id === comment.comment_id ? { ...item, ...summary } : item;
      if (comment.depth === 0) {
        setComments((current) => current.map(patch));
        return;
      }
      setReplies((current) => ({
        ...current,
        [comment.root_comment_id]: (current[comment.root_comment_id] ?? []).map(
          patch,
        ),
      }));
    };

    merge(applyReactionLocally(comment, next));
    void (async () => {
      try {
        merge(
          next === null
            ? await clearCommentReaction(comment.comment_id)
            : await setCommentReaction(comment.comment_id, next),
        );
      } catch (cause) {
        merge(comment);
        setError(getCommentErrorMessage(cause));
      }
    })();
  };

  return {
    comments,
    replies,
    expanded,
    countDelta,
    hasMore: nextCursor !== null,
    loading,
    pending,
    error,
    clearError: () => setError(null),
    loadMore,
    toggleReplies,
    create,
    edit,
    remove,
    react,
  };
}
