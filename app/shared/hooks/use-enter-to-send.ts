import { useCallback, useSyncExternalStore } from "react";

import {
  isSendEnter,
  readEnterToSend,
  writeEnterToSend,
} from "~/shared/lib/enter-to-send";

/** 같은 탭의 `setItem`은 `storage` 이벤트가 없어 직접 알린다. */
const CHANGE_EVENT = "kmla-online:enter-to-send-change";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** prerender와 첫 hydration에서는 기본값인 켜짐으로 그린다. */
function getServerSnapshot(): boolean {
  return true;
}

/** `Enter`로 보내기는 기기와 키보드에 딸린 취향이라 `localStorage`에 둔다. */
export function useEnterToSend(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribe,
    readEnterToSend,
    getServerSnapshot,
  );

  const setEnabled = useCallback((next: boolean) => {
    writeEnterToSend(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [enabled, setEnabled];
}

/**
 * 입력창의 `keydown`에 쓰는 판별. 설정을 함께 읽어, 입력창이 설정을 빠뜨리고 판별할 길을 없앤다.
 */
export function useIsSendEnter(): (
  event: Pick<KeyboardEvent, "key" | "code" | "shiftKey">,
) => boolean {
  const [enabled] = useEnterToSend();
  return useCallback((event) => isSendEnter(event, enabled), [enabled]);
}
