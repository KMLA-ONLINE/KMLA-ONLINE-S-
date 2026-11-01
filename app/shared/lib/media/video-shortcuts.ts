export type VideoShortcut =
  | { type: "toggle" }
  | { type: "seek"; seconds: number }
  | { type: "seek-percent"; percent: number }
  | { type: "volume"; delta: number }
  | { type: "mute" }
  | { type: "fullscreen" };

/**
 * 뷰어의 동영상 단축키. 유튜브와 같게 둔다. 글자가 아니라 `KeyboardEvent.code`로 판단한다. 한글 입력
 * 상태에서는 K 키의 `key`가 `ㅏ`로 온다.
 */
export function videoShortcutFor(code: string): VideoShortcut | null {
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit) return { type: "seek-percent", percent: Number(digit[1]) * 10 };
  switch (code) {
    case "Space":
    case "KeyK":
      return { type: "toggle" };
    case "ArrowLeft":
      return { type: "seek", seconds: -5 };
    case "ArrowRight":
      return { type: "seek", seconds: 5 };
    case "KeyJ":
      return { type: "seek", seconds: -10 };
    case "KeyL":
      return { type: "seek", seconds: 10 };
    case "ArrowUp":
      return { type: "volume", delta: 0.05 };
    case "ArrowDown":
      return { type: "volume", delta: -0.05 };
    case "KeyM":
      return { type: "mute" };
    case "KeyF":
      return { type: "fullscreen" };
    default:
      return null;
  }
}

export function formatPlaybackTime(seconds: number): string {
  const total = Math.floor(Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, "0");
  if (minutes < 60) return `${minutes}:${rest}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${rest}`;
}
