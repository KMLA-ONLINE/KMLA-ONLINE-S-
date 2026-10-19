/**
 * 그룹 게시물·댓글의 사용자 멘션(기능 명세 §8.14). 본문에는 `[@표시이름](m:<ordinal>)` 토큰만 남고 대상은 서버의 `post_mentions`/`comment_mentions`에 있다
 * (`pub_id`는 바뀔 수 있어 박지 않는다, 기능 명세 §12.2). 토큰이 CommonMark 링크인 것은 Milkdown이 커스텀 노드 없이 그려 주기 때문이다.
 */

/** 기능 명세 §8.14. 게시물 또는 댓글 하나가 부를 수 있는 사람 수. */
export const MENTION_LIMIT = 50;

/**
 * 대화 전체를 부르는 멘션의 번호(메시지의 `@모든 사람`). 사람 번호(1~)와 겹치지 않고 대상 목록에 들지 않아,
 * 제출 직전 번호를 다시 매길 때도 그대로 남는다. 게시물과 댓글은 쓰지 않는다 — 서버가 짝 없는 번호로 거절한다.
 */
export const EVERYONE_MENTION_ORDINAL = 0;

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

/** 멘션 토큰 문법. 서버의 `private.parse_mention_ordinals`와 **글자 그대로 같아야 한다**. `g` 플래그 정규식은 `lastIndex`를 들고 다니므로 쓰는 쪽이 매번 새 것을 받는다. */
export function mentionTokenPattern(): RegExp {
  return /\[@([^\]\n]*)\]\(m:([0-9]{1,2})\)/g;
}

const MENTION_HREF = /^m:([0-9]{1,2})$/;

/** 토큰 안의 표시 이름은 장식이다. `]`나 `\`는 토큰 문법을 깨 서버가 못 보므로 덜어낸다. */
export function sanitizeMentionLabel(name: string): string {
  // `[` `]` `\`는 토큰 문법을 깨 서버가 멘션을 못 본다. `*` `_` 백틱은 링크 안쪽을 중첩 노드로 만들어 폴백 라벨이 문자열이 아니게 된다(`@`만 남는다).
  return name.replace(/[[\]\\*_`\r\n]/g, "").trim();
}

export function buildMentionToken(name: string, ordinal: number): string {
  return `[@${sanitizeMentionLabel(name)}](m:${ordinal})`;
}

/** 토큰을 `@이름` 글자로 바꾼다. 복사나 한 줄 미리보기처럼 멘션을 글자로만 보여 주는 곳이 쓴다. */
export function mentionPlainText(text: string): string {
  return text.replace(
    mentionTokenPattern(),
    (_token, label: string) => `@${label}`,
  );
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

/** 작성 중 편집기가 들고 있는 대상. ordinal 하나에 한 사람이다. `EVERYONE_MENTION_ORDINAL`이면 사람이 아니라 `pubId`가 비어 있다. */
export interface MentionDraftEntry {
  ordinal: number;
  pubId: string;
  name: string;
}

/** 멘션으로 부를 사람 한 명. */
export interface MentionTarget {
  pubId: string;
  name: string;
}

/**
 * 고른 사람들에게 줄 번호와 그 뒤의 초안. 고른 순서대로 돌려주며 자리가 모자라 번호를 못 받은 사람은 빠진다. 같은 사람은 쓰던 번호를 돌려준다.
 * 번호는 원문의 토큰을 보고 고른다 — 표시형에는 토큰이 없어 언제나 1이 나온다. 한 번에 고른 사람들은 아직 본문에 없으므로 앞사람의 토큰을 이어 붙인 본문으로 다음 번호를 고른다.
 * 본문에서 사라진 번호를 다시 쓸 때는 그 번호의 옛 항목을 버린다.
 */
export function assignMentionOrdinals(
  entries: MentionDraftEntry[],
  targets: MentionTarget[],
  body: string,
): { entries: MentionDraftEntry[]; assigned: MentionDraftEntry[] } {
  let next = entries;
  let pending = body;
  const assigned: MentionDraftEntry[] = [];
  for (const target of targets) {
    const existing = next.find((entry) => entry.pubId === target.pubId);
    const ordinal =
      existing &&
      existing.ordinal !== EVERYONE_MENTION_ORDINAL &&
      existing.ordinal <= MENTION_LIMIT
        ? existing.ordinal
        : nextMentionOrdinal(pending);
    if (ordinal === null) continue;
    if (existing?.ordinal !== ordinal) {
      next = [
        ...next.filter((entry) => entry.ordinal !== ordinal),
        { ordinal, pubId: target.pubId, name: target.name },
      ];
    }
    pending += buildMentionToken(target.name, ordinal);
    assigned.push({ ordinal, pubId: target.pubId, name: target.name });
  }
  return { entries: next, assigned };
}

/** 제출 직전 정규화. 본문에 남은 토큰만 등장 순서대로 1부터 다시 매긴다(서버는 ordinal을 1~50 첨자로 받는다). 같은 사람은 ordinal 하나를 쓴다. */
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
      if (entry.ordinal === EVERYONE_MENTION_ORDINAL)
        return buildMentionToken(entry.name, EVERYONE_MENTION_ORDINAL);

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

/** 상한을 넘었으면 사용자에게 보여줄 이유, 아니면 `null`. 경계는 서버에 있지만(§8.14) 버튼을 거치지 않은 토큰을 입력창 옆 문구로 알린다. */
export function validateMentionCount(
  body: string,
  entries: MentionDraftEntry[],
): string | null {
  return mentionCountReason(countMentionTargets(body, entries));
}

/** 서로 다른 대상 수가 상한을 넘었으면 보여줄 이유. 대상 수를 이미 셌으면 이것을 바로 부른다. */
export function mentionCountReason(targetCount: number): string | null {
  if (targetCount <= MENTION_LIMIT) return null;
  return `멘션은 ${MENTION_LIMIT}명까지 할 수 있습니다.`;
}

/** 수정할 때 편집기가 이어받을 초안. 읽기 RPC의 `mentions`가 ordinal 표이며, 탈퇴한 사용자는 초안에서 빼 제출 때 평문이 된다. */
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

/**
 * 표시형 멘션 앞에 붙는 보이지 않는 표시(U+2060 WORD JOINER 등). 이름만 보고 짝을 지으면 손으로 친 글이 멘션이 되어 부른 적 없는 사람에게 알림이 가므로,
 * 버튼이 넣은 자리만 표시로 되돌린다. 표시가 여럿인 것은 동명이인 때문이다(`mentionDisplaySlot()`). 표시가 떨어지면 멘션은 평문이 된다.
 */
const MENTION_DISPLAY_MARKS = [
  "\u2060",
  "\u2061",
  "\u2062",
  "\u2063",
  "\u2064",
];

/** ordinal 1이 쓰는 첫 표시. */
export const MENTION_DISPLAY_MARK = MENTION_DISPLAY_MARKS[0];

/**
 * 이 ordinal이 쓰는 표시 번호. 초안의 다른 항목을 보지 않는다 — 자리가 하나 빠질 때 표시가 밀려 옆 사람을 가리키지 않게.
 * 표시는 다섯 개뿐이라 5 차이 동명이인은 먼저 부른 쪽이 가져간다.
 */
export function mentionDisplaySlot(ordinal: number): number {
  // `EVERYONE_MENTION_ORDINAL`(0)도 음수 없이 마지막 표시를 쓴다.
  const count = MENTION_DISPLAY_MARKS.length;
  return (((ordinal - 1) % count) + count) % count;
}

/** 입력창에 넣을 표시형 한 조각. 버튼이 이것을 넣고 `fromMentionDisplay()`가 이것만 되돌린다. */
export function mentionDisplayText(name: string, ordinal: number): string {
  return `${MENTION_DISPLAY_MARKS[mentionDisplaySlot(ordinal)]}@${name}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 표시형에서 보이지 않는 표시를 걷어 화면에 보이는 글자만 남긴다. */
export function stripDisplayMarks(text: string): string {
  return MENTION_DISPLAY_MARKS.reduce(
    (result, mark) => result.replaceAll(mark, ""),
    text,
  );
}

/**
 * 표시형. `textarea`는 글자 일부만 달리 그릴 수 없어 입력창은 `@홍길동`을 들고 제출 직전 `fromMentionDisplay()`가 토큰으로 되돌린다.
 * 이름은 라벨이 아니라 초안에서 가져오며, 초안이 모르는 ordinal은 평문으로 둔다.
 */
export function toMentionDisplay(
  body: string,
  entries: MentionDraftEntry[],
): string {
  const byOrdinal = new Map(entries.map((entry) => [entry.ordinal, entry]));

  return body.replace(
    mentionTokenPattern(),
    (_token, label: string, rawOrdinal: string) => {
      const entry = byOrdinal.get(Number(rawOrdinal));
      if (!entry) return `@${label}`;

      return mentionDisplayText(entry.name, entry.ordinal);
    },
  );
}

/** 표시형 본문이 들고 있는 멘션 한 자리. 입력창이 통째로 지울 범위이기도 하다. */
export interface MentionDisplayRange {
  start: number;
  end: number;
  entry: MentionDraftEntry;
}

/** 표시형 본문에서 버튼이 넣은 멘션 자리를 찾는다. 표시가 붙고 뒤가 초안의 이름이어야 한 자리다. */
export function mentionDisplayRanges(
  text: string,
  entries: MentionDraftEntry[],
): MentionDisplayRange[] {
  const ordered = [...entries].sort(
    (left, right) => left.ordinal - right.ordinal,
  );
  const names = Array.from(
    new Set(ordered.map((entry) => entry.name).filter((name) => name !== "")),
  ).sort(
    // 긴 이름을 먼저 본다. `김민`이 `김민수`를 반으로 자르지 않게 한다.
    (left, right) => right.length - left.length,
  );
  if (names.length === 0) return [];

  const pattern = new RegExp(
    `([${MENTION_DISPLAY_MARKS.join("")}])@(${names.map(escapeRegExp).join("|")})`,
    "g",
  );
  const ranges: MentionDisplayRange[] = [];

  for (const match of text.matchAll(pattern)) {
    const slot = MENTION_DISPLAY_MARKS.indexOf(match[1]);
    // 이름과 표시가 함께 맞아야 한 자리다. 짝이 없으면 그 글자는 멘션이 아니다 — 초안이
    // 그 사람을 잃은 뒤에도 남아 있던 글자가 옆 사람을 부르지 않는다.
    const entry = ordered.find(
      (candidate) =>
        candidate.name === match[2] &&
        mentionDisplaySlot(candidate.ordinal) === slot,
    );
    if (!entry) continue;

    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      entry,
    });
  }

  return ranges;
}

/** 입력창이 편집마다 부르는 정리. 멘션 가운데를 고치면 남은 보이지 않는 표시가 나중에 조용히 멘션으로 되살아나므로 걷는다. */
export function sanitizeMentionDisplay(
  text: string,
  entries: MentionDraftEntry[],
): string {
  const ranges = mentionDisplayRanges(text, entries);
  let result = "";
  let last = 0;

  for (const range of ranges) {
    result +=
      stripDisplayMarks(text.slice(last, range.start)) +
      text.slice(range.start, range.end);
    last = range.end;
  }

  return result + stripDisplayMarks(text.slice(last));
}

/** 표시형을 원문으로 되돌린다. 표시가 붙은 자리만 토큰이 되며 누구인지는 표시가 정한다. 짝 없는 표시는 제출 전에 지운다. */
export function fromMentionDisplay(
  text: string,
  entries: MentionDraftEntry[],
): string {
  const ranges = mentionDisplayRanges(text, entries);
  if (ranges.length === 0) return stripDisplayMarks(text);

  // 붙여넣기로 들어온 토큰 안은 건드리지 않는다. 토큰을 두 번 감싸지 않기 위해서다.
  const tokens = Array.from(text.matchAll(mentionTokenPattern()), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const inToken = (range: MentionDisplayRange) =>
    tokens.some((token) => token.start < range.end && range.start < token.end);

  let result = "";
  let last = 0;

  for (const range of ranges) {
    if (inToken(range)) continue;
    result +=
      stripDisplayMarks(text.slice(last, range.start)) +
      buildMentionToken(range.entry.name, range.entry.ordinal);
    last = range.end;
  }

  return result + stripDisplayMarks(text.slice(last));
}

/** 지울 범위의 [from, to). 멘션 자리는 [start, end)다. */
export interface DeletionRange {
  from: number;
  to: number;
}

const MENTION_DELETE_INPUT =
  /^delete(Content|Word|SoftLine|HardLine|EntireSoftLine)/;

/**
 * 멘션을 한 덩어리로 지울지 볼 `beforeinput`. 댓글 입력창과 본문 편집기가 함께 쓴다. keydown이 아니라 이것을 보는 것은
 * 모바일 키보드가 Backspace를 keyCode 229로 보내 `key`가 비기 때문이다. 잘라내기·끌어 옮기기는 범위를 사람이 직접 고른 것이라 그대로 둔다.
 */
export function isMentionDeleteInput(inputType: string): boolean {
  return MENTION_DELETE_INPUT.test(inputType);
}

/** 사람이 범위를 직접 고른 삭제(잘라내기·끌어 옮기기). 멘션에 걸쳐도 넓히지 않는다. */
export function isPickedDeleteInput(inputType: string): boolean {
  return inputType === "deleteByCut" || inputType === "deleteByDrag";
}

/** 브라우저가 범위를 알려 주지 않을 때의 지울 범위. 선택이 있으면 그 범위, 없으면 캐럿 앞뒤 한 글자다. */
export function caretDeletionRange(
  selection: DeletionRange,
  inputType: string,
): DeletionRange {
  const { from, to } = selection;
  if (from !== to) return selection;
  return inputType.endsWith("Backward")
    ? { from: from - 1, to }
    : { from, to: to + 1 };
}

/**
 * 브라우저가 이미 지운 범위. `after`가 `before`에서 캐럿 자리의 한 덩어리만 빠진 값이면 그 자리, 아니면 `null`이다.
 * `textarea`의 단어·줄 삭제는 지우기 전에 범위를 알 수 없어 지운 뒤에 찾는다. 지운 뒤 캐럿은 앞뒤 어느 방향이든 지운 자리의 앞이다.
 */
export function removedRange(
  before: string,
  after: string,
  caret: number,
): DeletionRange | null {
  const removed = before.length - after.length;
  if (removed <= 0) return null;
  if (
    before.slice(0, caret) !== after.slice(0, caret) ||
    before.slice(caret + removed) !== after.slice(caret)
  )
    return null;
  return { from: caret, to: caret + removed };
}

/** 지울 범위가 멘션에 조금이라도 닿으면 그 멘션까지 넓힌다. 닿지 않으면 `null` — 브라우저에 맡긴다. 반쪽 멘션은 남기지 않는다. */
export function expandDeletionOverMentions(
  range: DeletionRange,
  mentions: { start: number; end: number }[],
): DeletionRange | null {
  const touched = mentions.filter(
    (mention) => mention.start < range.to && range.from < mention.end,
  );
  if (touched.length === 0) return null;
  return {
    from: Math.min(range.from, ...touched.map((mention) => mention.start)),
    to: Math.max(range.to, ...touched.map((mention) => mention.end)),
  };
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

/** RPC 행의 `mentions`를 화면 타입으로 좁힌다. 생성기의 `Json` 컬럼이 컴포넌트까지 흘러가지 않게 한다. */
export function withMentions<T extends { mentions: unknown }>(
  row: T,
): Omit<T, "mentions"> & { mentions: PostMention[] } {
  return { ...row, mentions: parseMentions(row.mentions) };
}
