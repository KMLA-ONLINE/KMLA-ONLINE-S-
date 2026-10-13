/**
 * 대화방을 떠났다 돌아와도 쓰던 글과 쌓아 둔 첨부를 되살린다. 대화방은 방마다 다시 마운트되므로
 * 화면 state만으로는 다른 방에 다녀오거나 삭제 모드에 들어갔다 나오면 사라진다.
 *
 * 탭 메모리에만 둔다. 새로고침하면 버린다. 계정이 바뀌어도 남의 초안이 보이지 않게 보는 사람 ID를
 * 키에 넣는다.
 */
interface RoomDraft {
  text: string;
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
  const next = { text: "", files: [], ...drafts.get(key), ...patch };
  if (next.text === "" && next.files.length === 0) drafts.delete(key);
  else drafts.set(key, next);
}

/** 테스트가 서로의 초안을 물려받지 않게 비운다. */
export function clearRoomDrafts() {
  drafts.clear();
}
