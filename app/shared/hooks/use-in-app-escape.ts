import { useEffect, useState, useSyncExternalStore } from "react";

import {
  getInAppEscape,
  type InAppEscape,
} from "~/shared/lib/install-platform";

/** 자동으로 넘긴 적이 있는지. 돌아왔을 때나 새로고침했을 때 다시 튕겨 내지 않으려고 탭 단위로 남긴다. */
const AUTO_ESCAPE_KEY = "kmla-online:in-app-escape-tried";

export interface InAppEscapeState {
  escape: InAppEscape | null;
  /** 배너를 그려야 하는지. */
  open: boolean;
  /** `escape.kind`가 `guide`가 아닐 때만 동작한다. 사용자 제스처 안에서 불러야 한다. */
  leave: () => void;
  dismiss: () => void;
}

/** UA는 문서가 살아 있는 동안 바뀌지 않는다. 첫 판별을 그대로 돌려줘야 스냅샷이 매번 같은 값이 된다. */
let escapeSnapshot: InAppEscape | null | undefined;

function readEscape(): InAppEscape | null {
  escapeSnapshot ??= getInAppEscape(window.location.href);
  return escapeSnapshot;
}

function subscribeNever(): () => void {
  return () => {
    // 바뀔 일이 없어서 해제할 구독도 없다.
  };
}

function readTried(): boolean {
  try {
    return sessionStorage.getItem(AUTO_ESCAPE_KEY) === "1";
  } catch {
    return false;
  }
}

function recordTried(): void {
  try {
    sessionStorage.setItem(AUTO_ESCAPE_KEY, "1");
  } catch {
    // 남기지 못하면 새로고침할 때 한 번 더 넘길 뿐이다.
  }
}

/**
 * 인앱 브라우저로 들어온 사용자를 앱이나 브라우저로 넘긴다.
 *
 * 넘길 길이 있으면 탭에서 처음 한 번 자동으로 넘긴다. `intent://`는 막는 버전이 있어 오류 화면이
 * 뜰 수 있지만, 돌아오면 배너가 남아 있어 버튼으로 다시 시도할 수 있다. 한 번만 시도하는 것은
 * 실패한 뒤 돌아오거나 새로고침할 때마다 다시 튕겨 내지 않기 위해서다.
 */
export function useInAppEscape(): InAppEscapeState {
  const escape = useSyncExternalStore(subscribeNever, readEscape, () => null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const current = getInAppEscape(window.location.href);
    if (!current || current.kind === "guide" || readTried()) return;
    recordTried();
    window.location.href = current.url;
  }, []);

  return {
    escape,
    open: escape !== null && !dismissed,
    leave: () => {
      // 그사이 다른 화면으로 옮겼을 수 있으니 지금 주소로 다시 만든다.
      const current = getInAppEscape(window.location.href);
      if (current && current.kind !== "guide")
        window.location.href = current.url;
    },
    dismiss: () => setDismissed(true),
  };
}
