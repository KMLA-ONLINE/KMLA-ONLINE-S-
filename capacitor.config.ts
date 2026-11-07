import type { CapacitorConfig } from "@capacitor/cli";

/**
 * iOS 앱(네이티브 셸) 설정. 번들 ID와 표시 이름은 docs/IOS_APP_TECHNICAL_DESIGN.md가 소유한다.
 *
 * `ios.contentInset`은 기본값(`never`)으로 둔다. 네이티브 탭바 플러그인이 탭바 높이만큼 하단
 * safe area를 늘리므로 `always`면 여백이 두 번 들어간다.
 */
const config: CapacitorConfig = {
  appId: "kr.hs.kmla.online",
  appName: "KMLA Online",
  webDir: "build/client",
};

export default config;
