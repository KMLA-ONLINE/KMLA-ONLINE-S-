import { useCallback, useRef, useState } from "react";

import {
  MENTION_LIMIT,
  countMentionTargets,
  nextMentionOrdinal,
  normalizeMentions,
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
 * 같은 사람을 다시 고르면 쓰던 번호를 돌려준다. 그래야 "최대 50명"이 사람 수와 맞는다.
 */
export function useMentionDraft(initial: PostMention[] = []) {
  const [entries, setEntries] = useState<MentionDraftEntry[]>(() =>
    toMentionDraft(initial),
  );
  const entriesRef = useRef(entries);

  /** 고른 사람에게 줄 번호. 이 번호로 본문에 토큰을 넣는다. */
  const register = useCallback(
    (candidate: MentionCandidate, body: string): number | null => {
      const current = entriesRef.current;
      const existing = current.find(
        (entry) => entry.pubId === candidate.pub_id,
      );
      if (existing && existing.ordinal <= MENTION_LIMIT)
        return existing.ordinal;

      const ordinal = nextMentionOrdinal(body);
      if (ordinal === null) return null;
      const next = [
        ...current.filter((entry) => entry.ordinal !== ordinal),
        { ordinal, pubId: candidate.pub_id, name: candidate.name },
      ];
      entriesRef.current = next;
      setEntries(next);
      return ordinal;
    },
    [],
  );

  const reset = useCallback((mentions: PostMention[]) => {
    const next = toMentionDraft(mentions);
    entriesRef.current = next;
    setEntries(next);
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

/** 본문에 실제로 남아 있는 대상의 공개 ID. 상한에서도 중복 선택을 열어 둘 때 쓴다. */
export function activeMentionPubIds(
  body: string,
  entries: MentionDraftEntry[],
): string[] {
  return normalizeMentions(body, entries).pubIds;
}
