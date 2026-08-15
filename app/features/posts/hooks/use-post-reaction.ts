import { useState } from "react";
import { toast } from "sonner";

import {
  clearPostReaction,
  setPostReaction,
} from "~/features/posts/data/mutations";
import { listPostReactors } from "~/features/posts/data/queries";
import { getPostErrorMessage } from "~/features/posts/model/format";
import { applyReactionLocally } from "~/features/posts/model/reactions";
import type {
  PostReaction,
  PostReactor,
  ReactionSummary,
} from "~/features/posts/model/types";

/**
 * 게시물 하나의 반응 상태.
 *
 * 누르는 즉시 로컬 계산으로 숫자를 옮기고, RPC가 돌려준 정본으로 덮어쓴다. 반응은 연타로
 * 바뀌는 조작이라 왕복을 기다리면 눌린 뒤에야 숫자가 따라오며 눈에 띄게 끊긴다. 실패하면 누르기
 * 직전 상태로 되돌린다 — 반응 하나 때문에 화면을 다시 불러올 이유는 없다.
 *
 * 게시물 카드마다 하나씩 붙으므로 목록에서도 각자 자기 것만 갱신한다.
 */
export function usePostReaction(postId: string, initial: ReactionSummary) {
  const [summary, setSummary] = useState(initial);
  const [reactors, setReactors] = useState<PostReactor[] | null>(null);
  const [loadingReactors, setLoadingReactors] = useState(false);
  const [source, setSource] = useState(postId);

  // 같은 컴포넌트가 다른 게시물로 재사용되면(피드 페이지 이동) 로컬 상태를 버린다.
  if (source !== postId) {
    setSource(postId);
    setSummary(initial);
    setReactors(null);
  }

  const apply = async (next: PostReaction | null) => {
    const previous = summary;
    setSummary(applyReactionLocally(previous, next));
    // 반응이 바뀌면 이미 받아 둔 참여자 목록은 낡는다. 다음에 열 때 다시 받는다.
    setReactors(null);
    try {
      setSummary(
        next === null
          ? await clearPostReaction(postId)
          : await setPostReaction(postId, next),
      );
    } catch (cause) {
      setSummary(previous);
      toast.error(getPostErrorMessage(cause));
    }
  };

  const loadReactors = async () => {
    if (reactors || loadingReactors) return;
    setLoadingReactors(true);
    try {
      setReactors(await listPostReactors(postId));
    } catch (cause) {
      toast.error(getPostErrorMessage(cause));
    } finally {
      setLoadingReactors(false);
    }
  };

  return {
    summary,
    reactors: reactors ?? [],
    loadingReactors,
    select: (reaction: PostReaction) => void apply(reaction),
    clear: () => void apply(null),
    loadReactors: () => void loadReactors(),
  };
}
