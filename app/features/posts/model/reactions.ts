import type {
  PostReaction,
  ReactionSummary,
} from "~/features/posts/model/types";

/**
 * 반응 종류와 그래픽(기능 명세 §10, §18.4). 순서는 빠른 반응 줄 순서이자 DB `public.post_reaction` enum 순서여야 한다(서버가 enum 순서로 동률을 가른다).
 * `codepoint`는 `public/twemoji/` 파일 이름이다.
 */
export const REACTION_TYPES = [
  { key: "like", label: "좋아요", codepoint: "1f44d" },
  { key: "love", label: "하트", codepoint: "2764" },
  { key: "haha", label: "웃겨요", codepoint: "1f606" },
  { key: "wow", label: "놀라워요", codepoint: "1f62e" },
  { key: "sad", label: "슬퍼요", codepoint: "1f622" },
  { key: "angry", label: "화나요", codepoint: "1f621" },
] as const satisfies readonly {
  key: PostReaction;
  label: string;
  codepoint: string;
}[];

/** 반응 버튼을 짧게 눌렀을 때 붙는 반응(기능 명세 §10.1). */
export const DEFAULT_REACTION: PostReaction = "like";

const BY_KEY = new Map(REACTION_TYPES.map((type) => [type.key, type]));

export function reactionLabel(reaction: PostReaction): string {
  return BY_KEY.get(reaction)?.label ?? "반응";
}

/**
 * Twemoji SVG 경로. 자산은 서비스에 직접 담아 서비스 워커가 함께 캐시한다 — 외부 CDN을 쓰면
 * 오프라인에서 반응만 빈칸이 된다(`docs/CONTENT_FORMATTING.md` §8.2).
 */
export function reactionAssetPath(reaction: PostReaction): string {
  return `/twemoji/15.1.0/${BY_KEY.get(reaction)?.codepoint ?? "1f44d"}.svg`;
}

/** 서버 왕복 없이 다음 요약을 계산한다(연타에도 즉시 반응). 정본은 응답이 덮고, 상위 반응은 서버 집계라 다시 계산하지 않는다. */
export function applyReactionLocally(
  summary: ReactionSummary,
  next: PostReaction | null,
): ReactionSummary {
  const had = summary.my_reaction !== null;
  const has = next !== null;
  return {
    ...summary,
    my_reaction: next,
    reaction_count: summary.reaction_count + (has ? 1 : 0) - (had ? 1 : 0),
  };
}
