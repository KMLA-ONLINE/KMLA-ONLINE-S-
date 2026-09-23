/**
 * 그룹 화면 **안에서** 게시물 상세로 갈 때 심는 표식.
 *
 * 상세의 "◯◯ 그룹으로 이동" 링크를 감출지 정하는 데만 쓴다. 그 자리에서 뒤로가기가 이미 그룹을
 * 내놓으므로 링크가 한 번 더 있을 이유가 없다.
 *
 * 브라우저가 이전 history entry를 알려주지 않아 "어디서 왔는가"를 물을 방법이 이것뿐이다.
 * Chromium의 `navigation.entries()`는 Safari에 없어서, 설치형 PWA를 쓰는 기기마다 링크가
 * 나타났다 사라지게 된다.
 *
 * 심는 쪽이 그룹 안쪽 링크인 것이 중요하다. 반대로 알림·피드 쪽에 심어서 "있을 때만 보이게"
 * 하면, 표식을 빠뜨렸을 때 링크가 꼭 필요한 경우에 사라진다. 이 방향의 실수는 링크가 한 번 더
 * 보이는 것으로 끝난다.
 */
export const FROM_GROUP: { fromGroup: true } = { fromGroup: true };

/** `location.state`는 무엇이든 들어올 수 있으므로 좁혀서 읽는다. */
export function isFromGroup(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "fromGroup" in state &&
    state.fromGroup === true
  );
}
