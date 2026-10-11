import { useCallback, useRef, useState } from "react";

import {
  MENTION_LIMIT,
  buildMentionToken,
  countMentionTargets,
  nextMentionOrdinal,
  normalizeMentions,
  toMentionDraft,
  type MentionCandidate,
  type MentionDraftEntry,
  type PostMention,
} from "~/features/posts/model/mentions";

/**
 * 작성 중인 멘션 대상(기능 명세 §8.14). 번호를 올려 가며 쌓고 제출 직전 `normalizeMentions()`가 남은 토큰만 1부터 다시 매기므로,
 * 본문에서 토큰을 지워도 따로 지울 필요가 없다. 같은 사람은 쓰던 번호를 돌려준다.
 */
export function useMentionDraft(initial: PostMention[] = []) {
  const [entries, setEntries] = useState<MentionDraftEntry[]>(() =>
    toMentionDraft(initial),
  );
  const entriesRef = useRef(entries);

  /**
   * 고른 사람들에게 줄 번호. 고른 순서대로 돌려주며, 이 번호로 본문에 토큰을 넣는다. 자리가 모자라 번호를 못 받은 사람은 빠진다.
   * 한 번에 고른 사람들은 아직 본문에 없으므로, 앞사람에게 준 토큰을 이어 붙인 본문으로 다음 번호를 고른다.
   */
  const register = useCallback(
    (candidates: MentionCandidate[], body: string): MentionDraftEntry[] => {
      let next = entriesRef.current;
      let pending = body;
      const assigned: MentionDraftEntry[] = [];
      for (const candidate of candidates) {
        const existing = next.find((entry) => entry.pubId === candidate.pub_id);
        const ordinal =
          existing && existing.ordinal <= MENTION_LIMIT
            ? existing.ordinal
            : nextMentionOrdinal(pending);
        if (ordinal === null) continue;
        if (existing?.ordinal !== ordinal) {
          next = [
            ...next.filter((entry) => entry.ordinal !== ordinal),
            { ordinal, pubId: candidate.pub_id, name: candidate.name },
          ];
        }
        pending += buildMentionToken(candidate.name, ordinal);
        assigned.push({
          ordinal,
          pubId: candidate.pub_id,
          name: candidate.name,
        });
      }
      if (next !== entriesRef.current) {
        entriesRef.current = next;
        setEntries(next);
      }
      return assigned;
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
