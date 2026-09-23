import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { patchPostEngagement } from "~/features/posts/data/cache";
import { usePostEngagement } from "~/features/posts/hooks/use-post-engagement";
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
 * 같은 게시물을 그리는 카드·행·상세는 하나의 engagement overlay를 구독한다.
 */
export function usePostReaction(postId: string, initial: ReactionSummary) {
  const queryClient = useQueryClient();
  const summary = usePostEngagement(postId, { ...initial, comment_count: 0 });
  const [reactors, setReactors] = useState<PostReactor[] | null>(null);
  const [loadingReactors, setLoadingReactors] = useState(false);
  const [source, setSource] = useState(postId);

  // 같은 컴포넌트가 다른 게시물로 재사용되면(피드 페이지 이동) 로컬 상태를 버린다.
  if (source !== postId) {
    setSource(postId);
    setReactors(null);
  }

  const apply = async (next: PostReaction | null) => {
    const previous = summary;
    const optimistic = applyReactionLocally(previous, next);
    patchPostEngagement(queryClient, postId, {
      reaction_count: optimistic.reaction_count,
      my_reaction: optimistic.my_reaction,
    });
    // 반응이 바뀌면 이미 받아 둔 참여자 목록은 낡는다. 다음에 열 때 다시 받는다.
    setReactors(null);
    try {
      patchPostEngagement(
        queryClient,
        postId,
        next === null
          ? await clearPostReaction(postId)
          : await setPostReaction(postId, next),
      );
    } catch (cause) {
      patchPostEngagement(queryClient, postId, {
        reaction_count: previous.reaction_count,
        top_reactions: previous.top_reactions,
        my_reaction: previous.my_reaction,
      });
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
