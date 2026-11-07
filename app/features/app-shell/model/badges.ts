/**
 * 내비게이션 뱃지에 쓰는 안 읽음 수 표기(§3.2). 0 이하는 뱃지를 붙이지 않고 99를 넘으면 `99+`다.
 * HTML 탭바·사이드바의 `NavBadge`와 iOS 앱의 네이티브 탭바가 같은 표기를 쓴다.
 */
export function formatBadgeCount(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
