import { isHandheld } from "~/shared/lib/install-platform";

const STORAGE_KEY = "kmla-online:enter-to-send:v1";

/** 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서는 기본값인 켜짐으로 둔다. */
export function readEnterToSend(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeEnterToSend(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, "off");
  } catch {
    // 이번 화면에서만 적용된다.
  }
}

/**
 * 이 `Enter`로 입력창을 보낼까. 아니면 줄을 바꾼다.
 *
 * 폰·태블릿이라도 물리 키보드를 붙이면 데스크톱처럼 `Enter`가 보내기, `Shift+Enter`가 줄바꿈이다.
 * 웹에는 키보드 연결 여부를 묻는 API가 없어 이 키 입력이 어디서 왔는지로 가른다. 화면 키보드는
 * 실제 키 위치가 없어 `code`를 빈 문자열로 보내고, 물리 키보드는 `"Enter"`를 보낸다. 키 입력마다
 * 보므로 쓰다가 키보드를 떼거나 붙여도 바로 따라간다.
 *
 * 조합 중의 `Enter`(IME 확정)는 입력창마다 판별이 달라 부르는 쪽이 먼저 거른다.
 */
export function isSendEnter(
  event: Pick<KeyboardEvent, "key" | "code" | "shiftKey">,
  enterToSend: boolean,
): boolean {
  if (event.key !== "Enter" || event.shiftKey || !enterToSend) return false;
  return !isHandheld() || event.code !== "";
}
