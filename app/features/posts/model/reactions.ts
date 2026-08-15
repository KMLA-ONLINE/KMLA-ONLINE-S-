import type {
  PostReaction,
  ReactionSummary,
} from "~/features/posts/model/types";

/**
 * 반응 종류와 그 그래픽 (기능 명세 §10, §19.4).
 *
 * 순서가 곧 빠른 반응 줄에 놓이는 순서다. 데이터베이스의 `public.post_reaction` enum과 같은
 * 순서를 지켜라 — 상위 반응이 같은 수로 묶일 때 서버가 enum 순서로 갈라 내려주므로, 여기서
 * 순서가 어긋나면 화면과 서버의 "많이 쓰인 순"이 서로 다르게 보인다.
 *
 * `codepoint`는 `public/twemoji/`에 넣어 둔 파일 이름이다. Unicode 이모지를 그대로 쓰면 기기마다
 * 다른 그림이 나오는데, 반응은 같은 것을 눌렀다는 사실이 보여야 해서 통일된 그래픽을 쓴다.
 * 본문과 댓글 텍스트는 여전히 기기 이모지 그대로다.
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

/** 아직 아무도 누르지 않은 상태. 서버가 새 요약을 주기 전까지의 초기값으로 쓴다. */
export const EMPTY_REACTION_SUMMARY: ReactionSummary = {
  reaction_count: 0,
  top_reactions: [],
  my_reaction: null,
};

/**
 * 서버 왕복 없이 다음 요약을 계산한다. 누르는 즉시 숫자가 반응해야 하는데, RPC를 기다리면
 * 연타할 때 화면이 뒤늦게 따라오며 튄다. 정본은 응답이 오면 그대로 덮어쓴다.
 *
 * 상위 반응은 서버가 실제 집계로 다시 내려주므로 여기서 다시 계산하지 않는다. 내 반응 하나로는
 * 다른 사람들의 순위를 알 수 없다.
 */
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
