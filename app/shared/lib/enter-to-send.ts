import { isHandheld } from "~/shared/lib/install-platform";

export const ENTER_TO_SEND_STORAGE_KEY = "kmla-online:enter-to-send:v1";

/** 저장하지 못한 선택도 이번 화면에서는 지킨다. 저장소를 못 쓰면 기본값인 켜짐에서 시작한다. */
let memoryEnterToSend = true;

export function readEnterToSend(): boolean {
  try {
    memoryEnterToSend =
      window.localStorage.getItem(ENTER_TO_SEND_STORAGE_KEY) !== "off";
  } catch {
    // 마지막으로 고른 값을 그대로 쓴다.
  }
  return memoryEnterToSend;
}

export function writeEnterToSend(enabled: boolean): void {
  memoryEnterToSend = enabled;
  try {
    if (enabled) window.localStorage.removeItem(ENTER_TO_SEND_STORAGE_KEY);
    else window.localStorage.setItem(ENTER_TO_SEND_STORAGE_KEY, "off");
  } catch {
    // 이번 화면에서만 적용된다.
  }
}

/**
 * 물리 키보드의 Enter인가.
 *
 * 웹에는 키보드 연결 여부를 묻는 API가 없어 키 입력이 어디서 왔는지로 가른다. 화면 키보드는 실제 키
 * 위치가 없어 `code`를 빈 문자열(브라우저에 따라 `"Unidentified"`)로 보내고, 물리 키보드는 키
 * 위치를 보낸다. 모르는 값은 화면 키보드로 본다 — 잘못 보내기보다 줄을 바꾸는 쪽이 덜 아프다.
 */
function isPhysicalEnter(event: Pick<KeyboardEvent, "code">): boolean {
  return event.code === "Enter" || event.code === "NumpadEnter";
}

/**
 * 이 `Enter`로 입력창을 보낼까. 아니면 줄을 바꾼다.
 *
 * 폰·태블릿이라도 물리 키보드를 붙이면 데스크톱처럼 `Enter`가 보내기, `Shift+Enter`가 줄바꿈이다.
 * 화면 키보드에는 `Shift+Enter`가 없어 `Enter`가 줄을 바꾸고 보내기는 버튼이 맡는다. 키 입력마다
 * 보므로 쓰다가 키보드를 떼거나 붙여도 바로 따라간다.
 *
 * 조합 중의 `Enter`(IME 확정)는 입력창마다 판별이 달라 부르는 쪽이 먼저 거른다.
 */
export function isSendEnter(
  event: Pick<KeyboardEvent, "key" | "code" | "shiftKey">,
  enterToSend: boolean,
): boolean {
  if (event.key !== "Enter" || event.shiftKey || !enterToSend) return false;
  return !isHandheld() || isPhysicalEnter(event);
}
