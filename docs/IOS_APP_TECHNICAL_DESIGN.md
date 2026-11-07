# iOS 앱(네이티브 셸) 기술 설계

KMLA Online의 iOS 앱은 같은 웹 빌드를 Capacitor 셸에 담은 것이다. 이 문서는 셸의 구성, 빌드와
실행 절차, 웹 코드가 셸을 판별하고 네이티브 기능을 쓰는 경계, 셸에서 제공하지 않는 기능과 후속
과제를 소유한다. 사용자에게 보이는 동작은 기능 명세가 소유한다: 내비게이션은
[§3.1·§3.4·§3.9](functional-spec/accounts.md#31-주요-내비게이션), 설치·새 버전 안내는
[§3.7](functional-spec/accounts.md#37-앱-설치-및-연결-상태-안내), 기기 알림은
[§14.10](functional-spec/notifications.md#1410-web-push-권한-안내), 앱 버전은
[§15.12](functional-spec/settings.md#1512-앱-버전). 용어는
[용어집의 실행 환경](functional-spec/glossary.md#실행-환경)을 따른다.

## 1. 구성

- Capacitor 8(`@capacitor/core`, `@capacitor/ios`, dev 의존성 `@capacitor/cli`). iOS 프로젝트는 Swift
  Package Manager를 쓰며 CocoaPods는 필요 없다. Xcode 26 이상이 필요하다(Capacitor 8의 요구이며
  App Store 업로드도 iOS 26 SDK를 요구한다).
- 번들 ID `kr.hs.kmla.online`, 표시 이름 `KMLA Online`. 둘 다 [`capacitor.config.ts`](../capacitor.config.ts)가
  정본이고 `ios/App/App.xcodeproj`와 `Info.plist`가 같은 값을 갖는다. 번들 ID는 스토어에 올린 뒤
  바꿀 수 없다.
- `webDir`는 `build/client`다. `npm run build`의 산출물을 `cap sync`가 `ios/App/App/public`으로
  복사한다. `ios/` 아래에서 `App/App/public`, `App/App/capacitor.config.json`, 빌드 산출물은
  `ios/.gitignore`가 제외하는 생성물이고 나머지(Xcode 프로젝트, `Info.plist`, 에셋 카탈로그,
  `CapApp-SPM/Package.swift`)는 커밋한다. `Package.swift`는 `cap sync`가 다시 쓴다.
- 웹뷰는 `capacitor://localhost` 스킴으로 로컬 파일을 서빙한다. 웹 코드가 보는 origin은 배포 주소가
  아니며, 모든 API 요청은 `VITE_SUPABASE_URL`로 간다. 로컬 Supabase(`http://127.0.0.1`)는 시뮬레이터에서
  ATS 예외 없이 접속된다.
- `ios.contentInset`은 기본값(`never`)이다. 네이티브 탭바 플러그인이 하단 safe area를 늘리므로
  `always`면 여백이 두 번 들어간다.

## 2. 빌드와 실행

```bash
npm run ios:sync   # npm run build && cap sync ios
npm run ios:open   # cap open ios → Xcode에서 시뮬레이터 또는 기기로 실행
```

- 웹 코드를 고친 뒤에는 `ios:sync`를 다시 돌려야 앱에 반영된다. 앱에 담긴 웹 자산은 빌드 시점에
  고정되므로 웹 배포와 앱 릴리스는 따로 간다(후속 과제 §6).
- 로컬 Supabase로 돌릴 때는 `.env.local`의 값이 그대로 빌드에 들어간다. 배포 빌드는 Vercel 환경
  변수가 아니라 빌드하는 쪽의 `.env.local`이 쓰이므로, 스토어 빌드는 운영 값을 넣은 환경에서
  만든다.
- CI(`quality.yml`)와 Playwright는 iOS 셸을 빌드하거나 실행하지 않는다. 셸 동작은 시뮬레이터에서
  손으로 확인한다(§7).

## 3. 네이티브 셸 판별

`app/shared/lib/native-shell.ts`의 `isNativeShell()`이 유일한 판별이다. `Capacitor.isNativePlatform()`을
감싸며 `window`가 없는 빌드 타임 렌더에서는 항상 false다. 설치형 PWA 판별(`isStandalone()`)과
섞지 않는다. 네이티브 셸에서는 `display-mode: standalone` 미디어 쿼리와 `navigator.standalone`이
모두 거짓이므로 설치형 분기는 저절로 타지 않는다.

웹 코드에서 판별을 쓰는 곳은 두 종류뿐이다.

- 셸 전용 네이티브 기능을 켜는 곳: `app/routes/app/layout.tsx`가 HTML 탭바 대신 네이티브 탭바를
  띄운다(§4).
- 셸에서 뜻이 없는 안내를 끄는 곳: `app/shared/hooks/use-install-prompt.ts`가 홈 화면 추가 안내를
  띄우지 않는다.

## 4. 네이티브 탭바

iOS 앱의 하단 탭바는 `@capawesome/capacitor-tab-bar`가 웹뷰 위에 띄우는 iOS 네이티브 탭바다.
iOS 26부터는 리퀴드 글라스 재질이고, 그 전 버전은 예전 탭바다. 브리지는
`app/features/app-shell/hooks/use-native-tab-bar.ts` 하나이며 플러그인을 부르는 곳도 거기뿐이다.
플러그인을 바꾸더라도 셸(`layout.tsx`)은 그대로여야 한다.

- 탭 id는 `model/nav-items.ts`의 경로(`/`, `/messenger`, `/groups`, `/noti`, `/menu`)이고 제목은 같은
  라벨이다. 아이콘은 SF Symbols `house`, `bubble.left.and.bubble.right`, `person.2`, `bell`,
  `square.grid.2x2`다. 선택된 탭은 UIKit이 채워진 변형을 쓰며, 선택 색은 시스템 기본값이고
  미선택 색은 iOS 26부터 시스템이 정한다.
- 표시는 현재 route의 `handle.chrome.bottomNav`를 따른다. `none`이면 숨긴다. `hide-on-scroll`
  화면에서도 스크롤로 숨기지 않는다. 셸의 `md` 경계(768px) 이상에서는 숨기고 데스크톱
  사이드바를 쓴다. 셸이 사라지면(로그아웃) 탭바도 숨긴다.
- 뱃지는 `useNavBadges()`의 메시지·알림 수를 `model/badges.ts`의 `formatBadgeCount`로 표기한다.
  `NavBadge`와 같은 규칙(99 초과는 `99+`)이다.
- 네이티브 탭을 누르면 `tabSelected` 이벤트로 그 경로로 이동하고, 앱 안에서 경로가 바뀌면
  `selectTabById`로 선택을 맞춘다. 이미 그 탭의 첫 화면이면 `isTabReselectClick`과 같은 판정으로
  이동하지 않고 스크롤 영역을 맨 위로 올린다.
- 플러그인이 탭바 높이만큼 웹뷰의 하단 safe area 인셋을 늘린다. 그래서 셸은 HTML 탭바의
  `--app-tabbar-h`를 더하지 않고 `--app-safe-b`만 더한다. `ScrollRegion`은 하단 nav가 있는 화면에서
  `pb-[var(--app-safe-b)]`를, `scroll: "route"`인 메신저는 `Outlet` 감싸개가 같은 여백을 갖는다.
  대화방처럼 `bottomNav: "none"`인 화면에서는 인셋이 원래대로 돌아와 입력창이 홈 인디케이터
  여백만 갖는다.
- 플러그인 호출은 한 줄의 promise 큐로 순서를 지킨다. 탭을 넣기 전에 `show()`가 가면 빈 바가 뜬다.

플러그인 선택: 더 큰 대안인 `@capgo/capacitor-native-navigation`은 웹뷰를 iOS 탭 컨트롤러 안에
넣어 스크롤 시 축소 같은 시스템 동작까지 준다. 지금은 셸 구조를 바꾸지 않는 오버레이 방식이
충분해 Capawesome(MIT, 0.x)을 쓰고, 시스템 동작이 필요해지면 브리지 훅만 바꿔 재검토한다.

## 5. 외관

`ios/App/App/Info.plist`의 `UIUserInterfaceStyle`을 `Light`로 고정한다. 앱의 기본 테마가 라이트이고
다크는 실험실 설정(§15.5)이라, 시스템 외관을 따르면 다크 기기에서 라이트 앱 위에 다크 유리
탭바가 뜬다. 테마 설정이 실험실을 벗어나면 웹 테마와 네이티브 외관을 동기화하는 방식으로
다시 다룬다(§6).

## 6. 셸에서 제공하지 않는 것과 후속 과제

네이티브 셸의 WKWebView는 `capacitor://` 스킴에서 서비스 워커를 등록하지 못한다. 앱은 서비스
워커 유무를 코드 전반에서 검사하므로 깨지지 않지만 다음이 꺼진다.

- Web Push와 홈 화면 배지. 알림 설정은 기기 알림을 사용 불가로 표시한다. **후속 과제**: APNs
  기반 기기 알림. 기기 토큰 저장과 `dispatch-notifications`의 APNs 발송 채널이 필요하다.
- 새 버전 확인과 새로고침 안내, 오프라인 앱 셸 캐시. 새 빌드는 App Store 업데이트로 배포한다.
  **후속 과제**: 웹 배포와 앱 릴리스의 동기화 규칙(OTA 업데이트 여부 포함).
- 홈 화면 추가 안내(끈다)와 웹 공유 대상(`share_target`). 공유 받기는 iOS 공유 확장이 따로
  필요하다.

그 밖의 알려진 제한과 후속 과제:

- 오프라인 배너와 React Query의 멈춤은 `navigator.onLine`만 본다. WKWebView는 기기 네트워크가
  바뀐 뒤 이 값을 거짓으로 굳히는 경우가 있어 앱을 다시 열어야 풀린다. **후속 과제**: Capacitor
  Network 플러그인의 연결 상태로 판정을 보강한다.
- 네이티브 탭바는 오버레이라 iOS 26의 스크롤 시 축소가 없다. 필요하면 Capgo 플러그인을 검토한다.
- 웹 다이얼로그와 시트는 웹뷰 안에 그려지므로 네이티브 탭바를 덮지 못한다. 다이얼로그가 떠 있는
  동안에도 탭바는 흐려지지 않고 눌린다. **후속 과제**: 다이얼로그가 열려 있는 동안 탭바를 숨기는
  셸 규칙을 정하거나 Capgo의 일시 중지 방식을 검토한다.
- 네이티브 외관은 라이트 고정이라 실험실 다크 테마에서는 탭바만 라이트다.
- 입력란 포커스 때 WKWebView의 키보드 액세서리 바(위·아래·완료)가 보인다. Capacitor 키보드
  플러그인으로 숨길 수 있다.
- iPad는 `md` 이상 폭의 데스크톱 레이아웃을 그대로 쓰며 네이티브 탭바를 쓰지 않는다. iPad 전용
  검증은 하지 않았다.
- 스토어 배포 전 결정: 배포 계정(개인 또는 학교 법인), 사용자 간 차단 기능(앱스토어 심사 지침
  1.2), 심사용 데모 계정, Android 동시 진행 여부.

## 7. 검증

시뮬레이터에서 손으로 확인한다. 로컬 Supabase를 띄운 뒤 `npm run ios:sync`, `npm run ios:open`으로
실행하고 시드 계정으로 로그인한다.

- 홈·메시지·그룹·알림·메뉴 다섯 탭이 네이티브 탭바에 보이고, 누르면 그 화면으로 가며 앱 안의
  이동이 선택에 반영된다.
- 대화방에 들어가면 탭바가 숨고 목록으로 돌아오면 다시 보인다.
- 기기를 가로로 돌려 `md` 이상 폭이 되면 탭바가 숨고 사이드바가 보인다. 세로로 돌리면 돌아온다.
- 로그아웃하면 로그인 화면 위에 탭바가 남지 않는다.
- 홈 화면 추가 안내가 뜨지 않고, 알림 설정의 기기 알림이 사용 불가로 보인다.
