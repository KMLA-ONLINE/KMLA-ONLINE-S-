import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

const PARAM = "panel";

/** 우리가 쌓은 오버레이 entry 수. 뒤로가기로 닫을 수 있는지와 몇 칸을 되돌릴지의 근거다. */
interface RoomOverlayLocationState {
  roomOverlayDepth?: number;
  /**
   * 대화 정보에서 연 오버레이인지. `?panel=`에는 맨 위 하나만 있으므로, 이 표시가 있으면 좁은
   * 화면이 대화 정보를 그 아래에 계속 깔아 둔다. 없으면 위 화면이 페이드인하는 동안 대화가 비친다.
   */
  roomOverlayAboveDetails?: boolean;
}

/** 대화방 위에 뜨는 화면. 반응한 사람 목록은 메시지 ID를 함께 둔다. */
export type RoomOverlay =
  | { kind: "details" }
  | { kind: "search" }
  | { kind: "pinned" }
  | { kind: "reactions"; messageId: string }
  | { kind: "shared"; tab: "media" | "files" };

function parseOverlay(value: string | null): RoomOverlay | null {
  switch (value) {
    case "details":
    case "search":
    case "pinned":
      return { kind: value };
    case "media":
    case "files":
      return { kind: "shared", tab: value };
  }
  if (value?.startsWith("reactions:")) {
    const messageId = value.slice("reactions:".length);
    return messageId ? { kind: "reactions", messageId } : null;
  }
  return null;
}

function formatOverlay(overlay: RoomOverlay): string {
  switch (overlay.kind) {
    case "shared":
      return overlay.tab;
    case "reactions":
      return `reactions:${overlay.messageId}`;
    default:
      return overlay.kind;
  }
}

/**
 * 대화방 오버레이(대화 정보, 검색, 고정 메시지, 반응한 사람, 공유된 미디어)의 열림 상태를 URL에 둔다
 * (`?panel=`).
 *
 * 모바일에서 이 화면들은 대화를 덮으므로 사용자는 뒤로가기로 닫는다. 열림 상태가 component state에만
 * 있으면 그 뒤로가기가 대화방 자체를 떠난다. 열 때마다 history entry를 하나 push해 두면 뒤로가기가
 * 그 entry만 pop한다(`useSearchDialogParam`과 같은 이유). 대화 정보에서 공유된 미디어를 열면 entry가
 * 둘 쌓이고, 뒤로가기는 미디어를 닫고 대화 정보로 돌아온다. 대화방 route는 쿼리만 바뀌면 loader를
 * 다시 돌리지 않는다.
 */
export function useRoomOverlayParam() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as RoomOverlayLocationState | null;
  const depth = locationState?.roomOverlayDepth ?? 0;
  const aboveDetails = locationState?.roomOverlayAboveDetails ?? false;
  const overlay = parseOverlay(searchParams.get(PARAM));
  const hasOverlay = overlay !== null;
  const detailsOpen = overlay?.kind === "details";
  const detailsShown = detailsOpen || (hasOverlay && aboveDetails);

  /**
   * 오버레이를 연다. `replace`면 지금 오버레이를 그 자리에서 바꾼다. 대화 정보에서 검색을 열 때처럼
   * 뒤로가기가 앞 화면으로 돌아오지 않아야 할 때 쓴다.
   */
  const open = useCallback(
    (next: RoomOverlay, { replace = false }: { replace?: boolean } = {}) => {
      const params = new URLSearchParams(searchParams);
      params.set(PARAM, formatOverlay(next));
      const stays = replace && hasOverlay;
      void setSearchParams(params, {
        preventScrollReset: true,
        replace: stays,
        // 대화방 entry의 다른 표시(`roomAboveList`)는 오버레이 entry에도 잇는다.
        state: {
          ...locationState,
          roomOverlayDepth: stays ? depth : depth + 1,
          // 자리를 바꾸면 바뀐 화면의 아래도 그대로다. 대화 정보를 바꾼 검색 아래에는 대화가 있다.
          // 대화 정보 위에 연 화면에서 또 열면 그 아래에도 대화 정보가 깔려 있다.
          roomOverlayAboveDetails: stays ? aboveDetails : detailsShown,
        } satisfies RoomOverlayLocationState,
      });
    },
    [
      aboveDetails,
      depth,
      detailsShown,
      hasOverlay,
      locationState,
      searchParams,
      setSearchParams,
    ],
  );

  // 주소를 들고 곧장 들어왔으면 pop할 entry가 없으므로 param만 지운다. 그 밖에는 뒤로 가야 브라우저
  // 뒤로가기가 닫은 오버레이를 다시 띄우지 않는다.
  const closeLevels = useCallback(
    async (levels: number) => {
      if (depth === 0) {
        if (!searchParams.has(PARAM)) return;
        const params = new URLSearchParams(searchParams);
        params.delete(PARAM);
        setSearchParams(params, {
          replace: true,
          preventScrollReset: true,
        });
        return;
      }
      await navigate(-Math.min(levels, depth));
    },
    [depth, navigate, searchParams, setSearchParams],
  );

  /** 맨 위 오버레이 하나를 닫는다. */
  const close = useCallback(() => void closeLevels(1), [closeLevels]);
  /** 쌓인 오버레이를 모두 닫는다. 원래 메시지로 이동할 때 쓴다. 닫힌 뒤에 끝난다. */
  const closeAll = useCallback(() => closeLevels(depth), [closeLevels, depth]);

  return {
    overlay,
    depth,
    /** 좁은 화면에서 대화 정보가 보여야 하는지. 대화 정보 자체이거나 그 위에 연 화면일 때다. */
    detailsShown,
    open,
    close,
    closeAll,
  };
}
