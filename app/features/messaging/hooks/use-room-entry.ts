import { useLocation } from "react-router";

/** 대화방 entry의 history state. */
export interface RoomEntryState {
  /** 이 대화방 entry 바로 아래가 대화 목록인지. 대화방의 뒤로 버튼이 몇 칸을 되돌릴지의 근거다. */
  roomAboveList?: boolean;
}

/**
 * 대화방을 열 때 쓸 history 옵션. 뒤로가기가 대화방에서 대화방으로 돌아오지 않도록, 대화방 위에서
 * 다른 대화방을 열면 지금 entry를 바꾼다. 대화 목록에서 열면 목록 위에 하나만 쌓고 표시를 남긴다.
 * 바꿀 때는 지금 entry의 표시를 그대로 잇는다. 프로필에서 들어온 대화방이면 그 아래는 목록이 아니다.
 */
export function useRoomEntry(inRoom: boolean): {
  replace: boolean;
  state: RoomEntryState;
} {
  const location = useLocation();
  const current = location.state as RoomEntryState | null;
  return inRoom
    ? { replace: true, state: { roomAboveList: current?.roomAboveList } }
    : { replace: false, state: { roomAboveList: true } };
}
