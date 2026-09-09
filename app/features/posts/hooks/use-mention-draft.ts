import { useCallback, useState } from "react";

import {
  MENTION_LIMIT,
  countMentionTargets,
  nextMentionOrdinal,
  toMentionDraft,
  type MentionCandidate,
  type MentionDraftEntry,
  type PostMention,
} from "~/features/posts/model/mentions";

/**
 * 작성 중인 멘션 대상(기능 명세 §8.14).
 *
 * 고른 사람은 번호를 올려 가며 쌓아 두고, 본문에 실제로 남은 토큰만 제출 직전
 * `normalizeMentions()`가 추려 1부터 다시 매긴다. 그래서 사용자가 본문에서 토큰을 지워도 여기서
 * 따로 지울 필요가 없다 — 본문이 정본이고 이 목록은 번호를 푸는 표다.
 *
 * 같은 사람을 다시 고르면 쓰던 번호를 돌려준다. 그래야 "최대 10명"이 사람 수와 맞는다.
 */
export function useMentionDraft(initial: PostMention[] = []) {
  const [entries, setEntries] = useState<MentionDraftEntry[]>(() =>
    toMentionDraft(initial),
  );

  /** 고른 사람에게 줄 번호. 이 번호로 본문에 토큰을 넣는다. */
  const register = useCallback((candidate: MentionCandidate): number => {
    let ordinal = 0;
    setEntries((current) => {
      const existing = current.find(
        (entry) => entry.pubId === candidate.pub_id,
      );
      if (existing) {
        ordinal = existing.ordinal;
        return current;
      }
      ordinal = nextMentionOrdinal(current);
      return [
        ...current,
        { ordinal, pubId: candidate.pub_id, name: candidate.name },
      ];
    });
    return ordinal;
  }, []);

  const reset = useCallback((mentions: PostMention[]) => {
    setEntries(toMentionDraft(mentions));
  }, []);

  return { entries, register, reset };
}

/** 본문에 지금 남아 있는 대상 수로 계산한 남은 자리. */
export function remainingMentions(
  body: string,
  entries: MentionDraftEntry[],
): number {
  return Math.max(0, MENTION_LIMIT - countMentionTargets(body, entries));
}
