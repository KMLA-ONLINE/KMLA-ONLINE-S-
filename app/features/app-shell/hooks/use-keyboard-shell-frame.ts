import type { CSSProperties } from "react";

import { useKeyboardViewport } from "~/shared/hooks/use-keyboard-viewport";

/**
 * 태블릿처럼 넓은 화면에서 키보드가 뜨면 셸을 보이는 영역(visual viewport)에 맞춘다. iOS(와 키보드에
 * layout을 줄이지 않는 Android 브라우저)는 화면 전체를 끌어올리므로, 고정된 셸이 통째로 밀려 대화방
 * 머리와 전역 헤더가 화면 위로 사라진다. layout이 키보드만큼 줄어드는 브라우저는 보이는 높이와 차이가
 * 없어 그대로 둔다. 좁은 화면은 대화방이 스스로 보이는 영역에 붙으므로(`RoomScreen`) md 이상에서만 쓴다.
 */
export function useKeyboardShellFrame(enabled: boolean): {
  className: string | undefined;
  style: CSSProperties | undefined;
} {
  const viewport = useKeyboardViewport(enabled, true);
  if (!viewport.keyboardOpen || viewport.height === null) {
    return { className: undefined, style: undefined };
  }
  return {
    className:
      "md:top-(--shell-keyboard-top) md:bottom-auto md:h-(--shell-keyboard-height)",
    style: {
      "--shell-keyboard-top": `${viewport.offsetTop}px`,
      "--shell-keyboard-height": `${viewport.height}px`,
    } as CSSProperties,
  };
}
