import type { MentionDraftEntry } from "~/features/posts/model/mentions";

/**
 * 대화방을 떠났다 돌아와도 쓰던 글과 쌓아 둔 첨부를 되살린다. 대화방은 방마다 다시 마운트되므로
 * 화면 state만으로는 다른 방에 다녀오거나 삭제 모드에 들어갔다 나오면 사라진다.
 *
 * 탭 메모리에만 둔다. 새로고침하면 버린다. 계정이 바뀌어도 남의 초안이 보이지 않게 보는 사람 ID를
 * 키에 넣는다.
 */
interface RoomDraft {
  /** 입력창의 표시형 값. 멘션 대상은 `mentions`가 든다. */
  text: string;
  mentions: MentionDraftEntry[];
  files: File[];
}

const drafts = new Map<string, RoomDraft>();

export function roomDraftKey(viewerId: string, conversationId: string) {
  return `${viewerId}:${conversationId}`;
}

export function readRoomDraft(key: string): RoomDraft | undefined {
  return drafts.get(key);
}

/** 바꾼 쪽만 덮는다. 글도 첨부도 비면 지운다. */
export function updateRoomDraft(key: string, patch: Partial<RoomDraft>) {
  const next = {
    text: "",
    mentions: [],
    files: [],
    ...drafts.get(key),
    ...patch,
  };
  if (next.text === "" && next.files.length === 0) drafts.delete(key);
  else drafts.set(key, next);
}

/**
 * 쓰던 글 뒤에 줄을 바꿔 덧붙인다. 다른 앱에서 공유받은 글이 그 방에 쓰던 초안을 덮지 않게 한다
 * (기능 명세 §13.24). 멘션은 순번으로 이어지므로 뒤에 붙이는 글은 멘션을 흐트러뜨리지 않는다. 쓰던 글
 * 끝의 줄바꿈은 걷어 사이가 늘 한 줄이 되게 한다.
 */
export function appendRoomDraftText(key: string, text: string) {
  const current = (drafts.get(key)?.text ?? "").trimEnd();
  updateRoomDraft(key, {
    text: current === "" ? text : `${current}\n${text}`,
  });
}

/** 테스트가 서로의 초안을 물려받지 않게 비운다. */
export function clearRoomDrafts() {
  drafts.clear();
}
