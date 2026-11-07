import { Capacitor } from "@capacitor/core";

/**
 * Capacitor 네이티브 셸(iOS 앱) 안에서 실행 중인가.
 *
 * 설치형 PWA 판별(`install-platform.ts`의 `isStandalone`)과는 별개다. 네이티브 셸에는 서비스
 * 워커가 없고, 홈 화면 추가 안내를 띄우면 안 되며, 하단 탭바를 네이티브로 그릴 수 있다.
 * 빌드 타임 렌더에는 `window`가 없으므로 항상 false다.
 */
export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  return Capacitor.isNativePlatform();
}
