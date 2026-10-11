/**
 * 끌어 닫기 동안 화면에 보일 이동량. 손가락이 멀리 가도 `limit` 근처에서 멈춘다.
 *
 * 화면을 손가락에 1:1로 붙이면 화면 끝까지 따라가 어색하다. 사용자에게 필요한 건 "놓으면
 * 닫힌다"는 신호뿐이라, 처음에는 거의 그대로 따라가다 점점 무거워지게 한다. 닫을지는 이 값이
 * 아니라 실제 손가락 이동량으로 판정해야 한다 — 이 값은 `limit`을 넘지 않는다.
 */
export function resistDrag(distance: number, limit: number): number {
  return (
    Math.sign(distance) * limit * (1 - Math.exp(-Math.abs(distance) / limit))
  );
}
