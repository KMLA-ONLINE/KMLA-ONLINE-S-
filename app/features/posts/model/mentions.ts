/**
 * 그룹 게시물·댓글의 사용자 멘션(기능 명세 §8.14).
 *
 * 본문에는 `[@표시이름](m:<ordinal>)` 토큰만 남고 실제 대상은 서버의 `post_mentions` /
 * `comment_mentions`에 있다. 본문에 `pub_id`를 박지 않는 이유는 공개 ID가 바뀔 수 있고
 * 놓아준 값을 남이 다시 쓸 수 있어서다(기능 명세 §12.2) — 박아 두면 오래된 멘션이 조용히
 * 다른 사람을 가리킨다.
 *
 * 토큰이 CommonMark 링크 그대로인 것은 의도한 것이다. Milkdown이 커스텀 노드 없이 링크로
 * 그려 주고, remark 왕복에서도 모양이 보존된다. 화면에 뜨는 이름은 토큰이 아니라 읽기 RPC가
 * 돌려주는 `mentions`에서 가져오므로 이름이 바뀌면 옛 글의 멘션도 함께 바뀐다.
 */

/** 기능 명세 §8.14. 게시물 또는 댓글 하나가 부를 수 있는 사람 수. */
export const MENTION_LIMIT = 50;

/** 읽기 RPC가 본문 옆에 실어 보내는 표현용 멘션. 탈퇴한 사용자는 이름과 공개 ID가 null이다. */
export interface PostMention {
  ordinal: number;
  pub_id: string | null;
  name: string | null;
  avatar_path: string | null;
}

/** 멘션 후보 한 명. 선생님은 기수가 없다. */
export interface MentionCandidate {
  pub_id: string;
  name: string;
  cohort: number | null;
  is_returning_student: boolean;
  profile_type: "student" | "alumni" | "teacher";
  avatar_path: string | null;
  /** 서명된 아바타 URL. 화면은 이쪽만 읽는다. */
  avatar_url: string | null;
}

/**
 * 멘션 토큰 문법. 서버의 `private.parse_mention_ordinals`와 **글자 그대로 같아야 한다** --
 * 한쪽만 알아보는 토큰이 생기면 화면에 없는 멘션이 알림을 보내거나, 짝을 못 찾은 ordinal 때문에
 * 저장이 통째로 막힌다.
 *
 * 새로 만들지 말고 이것을 쓰라고 내보낸다. `g` 플래그가 붙은 정규식은 `lastIndex`를 들고
 * 다니므로, 쓰는 쪽은 매번 새 것을 받아야 한다.
 */
export function mentionTokenPattern(): RegExp {
  return /\[@([^\]\n]*)\]\(m:([0-9]{1,2})\)/g;
}

const MENTION_HREF = /^m:([0-9]{1,2})$/;

/**
 * 토큰 안의 표시 이름은 장식이다 — 화면은 `mentions`에서 이름을 가져온다. 다만 `]`나 `\`가
 * 들어오면 토큰 문법이 깨져 서버 정규식이 그 멘션을 못 보므로 미리 덜어낸다.
 */
export function sanitizeMentionLabel(name: string): string {
  // `[` `]` `\`는 토큰 문법을 깨서 서버가 그 멘션을 못 보게 만든다. `*` `_` 백틱은 문법을
  // 깨지는 않지만 링크의 안쪽 텍스트를 중첩 노드로 만들어, 대상을 못 찾았을 때의 폴백 라벨이
  // 문자열이 아니게 된다 -- 그러면 이름 없이 `@`만 남는다.
  return name.replace(/[[\]\\*_`\r\n]/g, "").trim();
}

export function buildMentionToken(name: string, ordinal: number): string {
  return `[@${sanitizeMentionLabel(name)}](m:${ordinal})`;
}

/** Markdown 링크 주소가 멘션이면 그 ordinal, 아니면 null. */
export function mentionOrdinalFromHref(href: string): number | null {
  const match = MENTION_HREF.exec(href);
  if (!match) return null;
  const ordinal = Number(match[1]);
  return Number.isInteger(ordinal) && ordinal >= 1 ? ordinal : null;
}

export function isMentionHref(href: string): boolean {
  return mentionOrdinalFromHref(href) !== null;
}

export function mentionsByOrdinal(
  mentions: PostMention[],
): Map<number, PostMention> {
  return new Map(mentions.map((mention) => [mention.ordinal, mention]));
}

/** 작성 중 편집기가 들고 있는 대상. ordinal 하나에 한 사람이다. */
export interface MentionDraftEntry {
  ordinal: number;
  pubId: string;
  name: string;
}

/**
 * 제출 직전 정규화.
 *
 * 편집기는 멘션을 넣을 때마다 번호를 올려서 매기므로, 넣었다 지우기를 반복하면 본문에 두 명만
 * 남아도 번호가 50을 넘어간다. 서버는 ordinal을 `p_mention_pub_ids`의 첨자로 쓰고 1~50만
 * 받으므로, 본문에 실제로 남은 토큰만 등장 순서대로 1부터 다시 매긴다.
 *
 * 같은 사람이 두 번 불렸으면 ordinal 하나를 함께 쓴다 — 그래야 "최대 50명"이 사람 수와 맞다.
 */
export function normalizeMentions(
  body: string,
  entries: MentionDraftEntry[],
): { body: string; pubIds: string[] } {
  const byOrdinal = new Map(entries.map((entry) => [entry.ordinal, entry]));
  const assigned = new Map<string, number>();
  const pubIds: string[] = [];

  const nextBody = body.replace(
    mentionTokenPattern(),
    (_token, label: string, rawOrdinal: string) => {
      const entry = byOrdinal.get(Number(rawOrdinal));
      // 편집기가 모르는 토큰은 사용자가 직접 친 것이다. 부를 사람을 지어내지 않고 평범한
      // 글자로 남긴다 — 서버도 짝이 없는 ordinal은 거절한다.
      if (!entry) return `@${label}`;

      const existing = assigned.get(entry.pubId);
      if (existing !== undefined)
        return buildMentionToken(entry.name, existing);

      const ordinal = pubIds.length + 1;
      assigned.set(entry.pubId, ordinal);
      pubIds.push(entry.pubId);
      return buildMentionToken(entry.name, ordinal);
    },
  );

  return { body: nextBody, pubIds };
}

/** 본문에 지금 남아 있는 서로 다른 대상 수. 편집기가 상한을 알릴 때 쓴다. */
export function countMentionTargets(
  body: string,
  entries: MentionDraftEntry[],
): number {
  return normalizeMentions(body, entries).pubIds.length;
}

/**
 * 상한을 넘었으면 사용자에게 보여줄 이유, 아니면 `null`.
 *
 * 실제 경계는 서버에 있지만(§8.14), 기존 원문이나 댓글 입력에는 버튼을 거치지 않은 토큰이
 * 들어올 수 있다. 그때 일반 RPC 오류가 아니라 입력창 옆 문구로 알린다.
 */
export function validateMentionCount(
  body: string,
  entries: MentionDraftEntry[],
): string | null {
  if (countMentionTargets(body, entries) <= MENTION_LIMIT) return null;
  return `멘션은 ${MENTION_LIMIT}명까지 할 수 있습니다.`;
}

/**
 * 이미 게시된 글을 수정할 때 편집기가 이어받을 초안 상태.
 *
 * 읽기 RPC의 `mentions`가 곧 그 본문의 ordinal 표다. 탈퇴한 사용자는 부를 수 없으므로
 * 초안에서 뺀다 — 본문의 토큰은 남지만 제출할 때 평문으로 풀린다.
 */
export function toMentionDraft(mentions: PostMention[]): MentionDraftEntry[] {
  return mentions
    .filter(
      (mention): mention is PostMention & { pub_id: string; name: string } =>
        mention.pub_id !== null && mention.name !== null,
    )
    .map((mention) => ({
      ordinal: mention.ordinal,
      pubId: mention.pub_id,
      name: mention.name,
    }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 토큰 바깥의 글자에만 `map`을 적용한다. 붙여넣기로 들어온 토큰을 두 번 감싸지 않는다. */
function outsideMentionTokens(
  text: string,
  map: (segment: string) => string,
): string {
  const pattern = mentionTokenPattern();
  let result = "";
  let last = 0;

  for (const match of text.matchAll(pattern)) {
    result += map(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }

  return result + map(text.slice(last));
}

/**
 * 표시형. `textarea`로 쓰는 댓글 입력창이 원문 대신 보여 주는 글이다.
 *
 * Milkdown은 토큰을 링크로 그려 주지만 `textarea`는 글자 일부만 달리 그릴 수 없어서, 넣는
 * 순간부터 `[@홍길동](m:1)`이 그대로 보였다. 대신 입력창이 드는 값은 `@홍길동`이고 제출
 * 직전에 `fromMentionDisplay()`가 토큰으로 되돌린다.
 *
 * 이름은 토큰의 라벨이 아니라 초안 목록에서 가져온다. 라벨은 장식이라 개명 전 이름일 수 있고,
 * 되돌릴 때 짝을 찾는 것도 이 이름이다. 초안이 모르는 ordinal(탈퇴한 사용자)은 어차피
 * `normalizeMentions()`가 평문으로 푸므로 라벨을 그대로 쓴다.
 */
export function toMentionDisplay(
  body: string,
  entries: MentionDraftEntry[],
): string {
  const byOrdinal = new Map(entries.map((entry) => [entry.ordinal, entry]));

  return body.replace(
    mentionTokenPattern(),
    (_token, label: string, rawOrdinal: string) =>
      `@${byOrdinal.get(Number(rawOrdinal))?.name ?? label}`,
  );
}

/**
 * 표시형을 원문으로 되돌린다. 초안에 있는 이름만 토큰이 되므로, 고르지 않은 사람을 손으로
 * 쳐도 멘션이 되지 않는다.
 *
 * 같은 이름이 여럿이면 **나온 순서대로** 짝을 짓는다. 고른 순서와 본문에 넣은 순서가 같으므로
 * 보통은 그대로 맞고, 어긋나도 이름이 같은 사람들 사이에서만 어긋난다. 동명이인이라고 토큰을
 * 그대로 보여 주면 입력창에 원문이 다시 새어 나온다. 수가 모자라면 마지막 사람을 다시 쓴다 —
 * 같은 사람을 여러 번 부르는 것은 `normalizeMentions()`가 하나로 센다.
 */
export function fromMentionDisplay(
  text: string,
  entries: MentionDraftEntry[],
): string {
  const byName = new Map<string, MentionDraftEntry[]>();

  [...entries]
    .sort((left, right) => left.ordinal - right.ordinal)
    .forEach((entry) => {
      if (entry.name === "") return;
      const group = byName.get(entry.name);
      if (group) group.push(entry);
      else byName.set(entry.name, [entry]);
    });

  const names = Array.from(byName.keys()).sort(
    // 긴 이름을 먼저 본다. `김민`이 `김민수`를 반으로 자르지 않게 한다.
    (left, right) => right.length - left.length,
  );
  if (names.length === 0) return text;

  const pattern = new RegExp(`@(${names.map(escapeRegExp).join("|")})`, "g");
  const seen = new Map<string, number>();

  return outsideMentionTokens(text, (segment) =>
    segment.replace(pattern, (_match, name: string) => {
      const group = byName.get(name) ?? [];
      const index = seen.get(name) ?? 0;
      seen.set(name, index + 1);
      const entry = group[Math.min(index, group.length - 1)];

      return buildMentionToken(entry.name, entry.ordinal);
    }),
  );
}

/** 본문에서 쓰지 않는 가장 작은 멘션 번호. 모든 번호가 사용 중이면 `null`이다. */
export function nextMentionOrdinal(body: string): number | null {
  const used = new Set<number>();
  for (const match of body.matchAll(mentionTokenPattern())) {
    used.add(Number(match[2]));
  }
  for (let ordinal = 1; ordinal <= MENTION_LIMIT; ordinal += 1) {
    if (!used.has(ordinal)) return ordinal;
  }
  return null;
}

/** RPC의 `Json` 컬럼을 화면이 쓰는 모양으로 좁힌다. */
export function parseMentions(value: unknown): PostMention[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): PostMention[] => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const ordinal = row.ordinal;
    if (typeof ordinal !== "number") return [];
    return [
      {
        ordinal,
        pub_id: typeof row.pub_id === "string" ? row.pub_id : null,
        name: typeof row.name === "string" ? row.name : null,
        avatar_path:
          typeof row.avatar_path === "string" ? row.avatar_path : null,
      },
    ];
  });
}

/**
 * RPC 행 하나의 `mentions`를 화면 타입으로 좁힌다. `data/`가 RPC를 부른 자리마다 통과시켜,
 * 생성기가 `Json`으로 적어 내린 컬럼이 컴포넌트까지 그대로 흘러가지 않게 한다.
 */
export function withMentions<T extends { mentions: unknown }>(
  row: T,
): Omit<T, "mentions"> & { mentions: PostMention[] } {
  return { ...row, mentions: parseMentions(row.mentions) };
}
