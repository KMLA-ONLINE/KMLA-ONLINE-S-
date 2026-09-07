/**
 * 화면에 보여 줄 기수 표기. 복학생은 함께 생활하는 기수를 반영해 `n.5기`로 적는다 (§12.1).
 *
 * 기수가 없는 사용자는 `null`을 돌려준다. 자리를 비울지 "기수 없음"으로 채울지는
 * 화면마다 다르므로 대체 문구는 호출하는 쪽이 정한다.
 */
export function formatCohort(
  cohort: number | null,
  isReturningStudent: boolean,
): string | null {
  if (cohort === null) return null;
  return `${cohort + (isReturningStudent ? 0.5 : 0)}기`;
}
