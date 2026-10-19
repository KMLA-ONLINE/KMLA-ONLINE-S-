import type {
  ConversationMessage,
  MessageParticipant,
} from "~/features/messaging/model/types";
import {
  EVERYONE_MENTION_ORDINAL,
  assignMentionOrdinals,
  fromMentionDisplay,
  mentionTokenPattern,
  normalizeMentions,
  stripDisplayMarks,
  toMentionDisplay,
  type MentionDraftEntry,
  type MentionTarget,
} from "~/features/posts/model/mentions";

/**
 * 그룹 대화의 멘션. 토큰 문법과 표시형 입력 규칙은 게시물·댓글과 같고(`posts/model/mentions.ts`), 여기에는
 * 대화 참여자를 대상으로 삼는 부분과 `@모든 사람`만 둔다.
 */

export const EVERYONE_MENTION_NAME = "모든 사람";

const EVERYONE_ENTRY: MentionDraftEntry = {
  ordinal: EVERYONE_MENTION_ORDINAL,
  pubId: "",
  name: EVERYONE_MENTION_NAME,
};

/** 후보 목록의 한 줄. `target`이 없으면 `@모든 사람`이다. */
export interface MessageMentionSuggestion {
  key: string;
  name: string;
  avatarUrl: string | null;
  target: MentionTarget | null;
}

/** 혼자 친 자음(호환 자모)의 순서. 유니코드 첫소리 자모(U+1100~)와 같은 순서다. */
const LONE_CONSONANTS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

/**
 * 대소문자와 공백을 무시한 비교용 글자. 한글은 자모로 풀어 조합 중인 글자(`기`, 혼자 친 `ㄱ`)로도 `김`을 찾게 한다. 혼자 친
 * 자음은 이름을 풀어 쓴 첫소리와 다른 글자라 첫소리로 바꾼다.
 */
function searchKey(value: string): string {
  return Array.from(value.replace(/\s+/g, "").toLowerCase(), (char) => {
    const index = LONE_CONSONANTS.indexOf(char);
    return index === -1 ? char : String.fromCharCode(0x1100 + index);
  })
    .join("")
    .normalize("NFD");
}

/**
 * `@` 뒤에 친 글자로 거른 후보. 맨 위는 `@모든 사람`, 그 아래는 참여자 목록 순서다. 나와 나간 멤버, 공개 ID를 모르는 사람은
 * 부를 수 없어 뺀다.
 */
export function messageMentionSuggestions(
  participants: MessageParticipant[],
  viewerId: string,
  query: string,
): MessageMentionSuggestion[] {
  const key = searchKey(query);
  const everyone: MessageMentionSuggestion = {
    key: "everyone",
    name: EVERYONE_MENTION_NAME,
    avatarUrl: null,
    target: null,
  };
  const people = participants.flatMap(
    (participant): MessageMentionSuggestion[] =>
      participant.active && participant.id !== viewerId && participant.pubId
        ? [
            {
              key: participant.id,
              name: participant.name,
              avatarUrl: participant.avatarUrl,
              target: { pubId: participant.pubId, name: participant.name },
            },
          ]
        : [],
  );
  return [everyone, ...people].filter((suggestion) =>
    searchKey(suggestion.name).includes(key),
  );
}

/**
 * 방금 캐럿 바로 앞에 `@` 하나를 쳤으면 그 자리, 아니면 `null`. 붙여넣기나 다른 편집으로 생긴 `@`는 후보 목록을 열지 않는다.
 * 한글 조합 중에도 `textarea` 값은 바뀌므로 조합하던 글자는 이미 `previous`에 들어 있다.
 */
export function typedMentionTrigger(
  previous: string,
  next: string,
  caret: number,
): number | null {
  if (next.length !== previous.length + 1 || next[caret - 1] !== "@") {
    return null;
  }
  return next.slice(0, caret - 1) + next.slice(caret) === previous
    ? caret - 1
    : null;
}

/**
 * 열린 후보 목록의 검색어. `trigger`의 `@`부터 캐럿까지이며, 목록을 닫아야 하면 `null`이다. `@`가 지워졌거나, 캐럿이 그 앞으로
 * 갔거나, 공백·줄바꿈을 쳤으면 닫는다.
 */
export function mentionQueryAt(
  text: string,
  trigger: number,
  caret: number,
): string | null {
  if (text[trigger] !== "@" || caret <= trigger) return null;
  const query = text.slice(trigger + 1, caret);
  return /\s/.test(query) ? null : query;
}

/**
 * 고른 후보를 초안에 올린다. 사람에게는 본문 토큰을 보고 번호를 주고(`assignMentionOrdinals()`), `@모든 사람`은 고정 번호를
 * 쓴다. 번호가 모자라 부를 수 없으면 `null`이다.
 */
export function addMessageMention(
  entries: MentionDraftEntry[],
  suggestion: MessageMentionSuggestion,
  body: string,
): { entries: MentionDraftEntry[]; entry: MentionDraftEntry } | null {
  if (!suggestion.target) {
    return entries.some((entry) => entry.ordinal === EVERYONE_ENTRY.ordinal)
      ? { entries, entry: EVERYONE_ENTRY }
      : { entries: [...entries, EVERYONE_ENTRY], entry: EVERYONE_ENTRY };
  }
  const { entries: next, assigned } = assignMentionOrdinals(
    entries,
    [suggestion.target],
    body,
  );
  const [entry] = assigned;
  return entry ? { entries: next, entry } : null;
}

/** 서버로 보낼 원문과 대상. 남은 토큰만 1부터 다시 매기므로, 제출 뒤의 초안도 그 번호로 돌려준다(실패하면 되살린다). */
export interface PreparedMessageMentions {
  body: string;
  /** n번째가 n번 토큰의 공개 ID다. */
  mentionPubIds: string[];
  /** 본문이 `@모든 사람`을 부르는지. 서버도 본문에서 같은 값을 정한다. */
  mentionsEveryone: boolean;
  entries: MentionDraftEntry[];
}

/** 입력창의 표시형 값을 제출할 원문으로 바꾼다. */
export function prepareMessageMentions(
  text: string,
  entries: MentionDraftEntry[],
): PreparedMessageMentions {
  const { body, pubIds } = normalizeMentions(
    fromMentionDisplay(text, entries),
    entries,
  );
  const names = new Map(entries.map((entry) => [entry.pubId, entry.name]));
  const people = pubIds.map((pubId, index) => ({
    ordinal: index + 1,
    pubId,
    name: names.get(pubId) ?? "",
  }));
  const everyone = mentionsEveryone(body);
  return {
    body,
    mentionPubIds: pubIds,
    mentionsEveryone: everyone,
    entries: everyone ? [...people, EVERYONE_ENTRY] : people,
  };
}

function mentionsEveryone(body: string): boolean {
  return Array.from(body.matchAll(mentionTokenPattern())).some(
    (match) => Number(match[2]) === EVERYONE_MENTION_ORDINAL,
  );
}

/** 보낸 메시지의 멘션 정보. */
type MentionedMessage = Pick<
  ConversationMessage,
  "body" | "mentionProfileIds" | "mentionsEveryone"
>;

/**
 * 보낸 메시지의 멘션을 다시 초안으로 올린다(편집). 이름과 공개 ID는 지금 참여자 목록에서 찾고, 찾지 못한 사람은 빼서 제출 때
 * 평문이 되게 한다.
 */
export function messageMentionEntries(
  message: MentionedMessage,
  participants: MessageParticipant[],
): MentionDraftEntry[] {
  const byId = new Map(
    participants.map((participant) => [participant.id, participant]),
  );
  const people = (message.mentionProfileIds ?? []).flatMap(
    (profileId, index): MentionDraftEntry[] => {
      const participant = byId.get(profileId);
      return participant?.pubId
        ? [
            {
              ordinal: index + 1,
              pubId: participant.pubId,
              name: participant.name,
            },
          ]
        : [];
    },
  );
  return message.mentionsEveryone ? [...people, EVERYONE_ENTRY] : people;
}

/**
 * 고친 내용이 원래 메시지와 같은지. 토큰에 적힌 옛 이름이나 번호가 아니라 화면에 보이는 글자와 부르는 사람으로 비교한다 —
 * 그대로 저장했는데 개명한 사람의 토큰 이름이 바뀌었다고 수정으로 남거나, 대상을 잃은 멘션이 조용히 지워지지 않게 한다.
 */
export function isUnchangedEdit(
  message: MentionedMessage,
  edited: PreparedMessageMentions,
  participants: MessageParticipant[],
): boolean {
  const original = messageMentionEntries(message, participants);
  const originalPubIds = original
    .filter((entry) => entry.ordinal !== EVERYONE_MENTION_ORDINAL)
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((entry) => entry.pubId);
  return (
    visibleText(message.body, original) ===
      visibleText(edited.body, edited.entries) &&
    originalPubIds.join("\n") === edited.mentionPubIds.join("\n")
  );
}

function visibleText(body: string, entries: MentionDraftEntry[]): string {
  return stripDisplayMarks(toMentionDisplay(body, entries));
}

/** 낙관적으로 그릴 메시지의 멘션 대상. 공개 ID를 참여자 ID로 바꾼다. */
export function mentionProfileIdsOf(
  mentionPubIds: string[],
  participants: MessageParticipant[],
): string[] {
  return mentionPubIds.map(
    (pubId) =>
      participants.find((participant) => participant.pubId === pubId)?.id ?? "",
  );
}

/** `mentionProfileIdsOf()`의 반대. 다시 보낼 때 화면에 그린 대상으로 서버에 보낼 공개 ID를 되찾는다. */
export function mentionPubIdsOf(
  mentionProfileIds: string[],
  participants: MessageParticipant[],
): string[] {
  return mentionProfileIds.map(
    (profileId) =>
      participants.find((participant) => participant.id === profileId)?.pubId ??
      "",
  );
}

/** 보낸 메시지의 멘션 한 자리를 그릴 이름과 프로필. */
export interface MessageMentionView {
  name: string;
  /** 사람 멘션이고 프로필 주소를 알면 채운다. */
  pubId?: string;
}

/**
 * 본문 `m:n` 토큰의 대상. 이름은 지금 참여자 목록에서 찾는다. 대상을 알 수 없으면 `null`이고 평문으로 그린다. `m:0`은 서버가
 * `@모든 사람`이라고 확인한 메시지에서만 그렇게 그린다 — 이 기능 전에 같은 글자를 직접 쳐 둔 메시지가 있다.
 */
export function resolveMessageMention(
  ordinal: number,
  message: Pick<ConversationMessage, "mentionProfileIds" | "mentionsEveryone">,
  participantById: ReadonlyMap<string, MessageParticipant>,
): MessageMentionView | null {
  if (ordinal === EVERYONE_MENTION_ORDINAL) {
    return message.mentionsEveryone ? { name: EVERYONE_MENTION_NAME } : null;
  }
  const profileId = message.mentionProfileIds?.[ordinal - 1];
  const participant = profileId ? participantById.get(profileId) : undefined;
  return participant
    ? { name: participant.name, pubId: participant.pubId }
    : null;
}

/** 멘션을 `@지금 이름` 글자로 바꾼 본문. 복사처럼 글자로만 옮기는 곳이 쓴다. 대상을 모르면 토큰의 이름을 쓴다. */
export function messagePlainText(
  message: MentionedMessage,
  participantById: ReadonlyMap<string, MessageParticipant>,
): string {
  return message.body.replace(
    mentionTokenPattern(),
    (_token, label: string, ordinal: string) =>
      `@${resolveMessageMention(Number(ordinal), message, participantById)?.name ?? label}`,
  );
}
