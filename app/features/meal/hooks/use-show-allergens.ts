import { useCallback, useSyncExternalStore } from "react";

import {
  readShowAllergens,
  writeShowAllergens,
} from "~/features/meal/model/allergen-preference";

/** 같은 탭의 `setItem`은 `storage` 이벤트가 없어 직접 알린다. */
const CHANGE_EVENT = "kmla-online:meal-allergens-change";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** prerender와 첫 hydration에서는 꺼진 채로 그린다. */
function getServerSnapshot(): boolean {
  return false;
}

/** 알레르기 표시 여부는 기기 취향이라 `localStorage`에 둔다. */
export function useShowAllergens(): [boolean, (show: boolean) => void] {
  const show = useSyncExternalStore(
    subscribe,
    readShowAllergens,
    getServerSnapshot,
  );

  const setShow = useCallback((next: boolean) => {
    writeShowAllergens(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [show, setShow];
}
