import { isHandheld } from "~/shared/lib/install-platform";

/**
 * 이 `Enter`로 입력창을 보낼까. 아니면 줄을 바꾼다.
 *
 * 컴퓨터는 `Enter`로 보내고 `Shift+Enter`로 줄을 바꾼다. 폰·태블릿의 `Enter`는 늘 줄바꿈이고 보내기는
 * 버튼이 맡는다. 화면 키보드에는 `Shift+Enter`가 없다. 물리 키보드를 붙인 경우만 보내고 싶어도 웹에는
 * 키보드 연결 여부를 묻는 API가 없다. `code`로 가르려 했지만 iOS WebKit은 화면 키보드의 Return에도
 * `code: "Enter"`를 보내(`keyCode`만 보고 정한다) 화면 키보드에서 메시지가 나갔다.
 *
 * `window`를 읽으므로 이벤트 핸들러에서만 부른다. 조합 중의 `Enter`(IME 확정)는 입력창마다 판별이 달라
 * 부르는 쪽이 먼저 거른다.
 */
export function isSendEnter(
  event: Pick<KeyboardEvent, "key" | "shiftKey">,
): boolean {
  if (event.key !== "Enter" || event.shiftKey) return false;
  return !isHandheld();
}
