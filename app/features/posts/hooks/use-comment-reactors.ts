import { useState } from "react";
import { toast } from "sonner";

import { listCommentReactors } from "~/features/posts/data/queries";
import { getCommentErrorMessage } from "~/features/posts/model/format";
import type { PostReactor } from "~/features/posts/model/types";

/** 댓글 하나의 반응 참여자 목록. 열 때만 받는다 — 요약은 댓글 행에 실려 온다. */
export function useCommentReactors(commentId: string) {
  const [reactors, setReactors] = useState<PostReactor[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState(commentId);

  if (source !== commentId) {
    setSource(commentId);
    setReactors(null);
  }

  const load = async () => {
    if (reactors || loading) return;
    setLoading(true);
    try {
      setReactors(await listCommentReactors(commentId));
    } catch (cause) {
      toast.error(getCommentErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  return {
    reactors: reactors ?? [],
    loading,
    load: () => void load(),
    /** 내가 반응을 바꾸면 받아 둔 목록은 낡는다. 다음에 열 때 다시 받는다. */
    invalidate: () => setReactors(null),
  };
}
