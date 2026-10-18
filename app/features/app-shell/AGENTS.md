# app-shell feature

로그인한 사용자가 보는 앱 chrome과 bootstrap 데이터를 소유한다. 인증/승인 redirect는
`app/routes/app/gate.tsx`, React Router 레이아웃은 `app/routes/app/layout.tsx` 하나가 담당한다.

## 불변조건

- `app/routes.ts`가 인증 게이트 아래에 셸 layout 하나를 두고 메신저를 포함한 모든 앱 route를 그 아래에 둔다. 헤더와 사이드바가 화면 이동마다 다시 마운트되면 hover로 펼친 사이드바가 접혔다 펴진다.
- 앱 route는 typed `handle.chrome`으로 전역 헤더, 모바일 하단 nav와 스크롤 소유(`scroll`)를 설정한다.
- 일반 앱의 데스크톱 콘텐츠 폭도 `handle.chrome.contentWidth`가 소유한다. 기본은 `model/chrome.ts`의 `DEFAULT_APP_CHROME.contentWidth`(`4xl`)이고, 목록이나 폼처럼 다른 폭이 필요한 route만 명시적으로 override한다.
- 메신저 route는 `scroll: "route"`다. 셸은 `ScrollRegion`, 콘텐츠 폭, 당겨서 새로고침과 navigation skeleton 없이 `Outlet`을 셸 높이에 꽉 채운다. 모바일 하단 nav는 대화 목록에서 표시하고 대화방에서는 숨긴다.
- 인증/승인 게이트는 `app/routes/app/gate.tsx` 한 곳에만 둔다. 이용 정지(§16.11)된 사람은 상태가 `accepted`라도 셸 데이터의 `suspended`로 걸러 `/suspended`로 보낸다. `suspended`는 게이트만 보며 셸 값(`ShellData`)에는 싣지 않는다.
- 셸 loader(게이트)는 첫 진입에만 실행한다. 이후 셸 프로필은 `AppShellProvider`가 `shellProfileQuery`에서 읽으므로, 이름·아바타·역할을 바꾸는 action은 `refreshShellProfile()`을, 알림 뱃지를 바꾸는 action은 `notificationKeys.badge()` 무효화를 직접 부른다.
- 셸 밖의 안 읽음 표시(홈 화면 아이콘 숫자, 브라우저 탭 제목·아이콘)는 `UnreadBadgeSync` 한 곳이 알림·메시지 수의 합으로 쓴다. 사이드바 뱃지와 같은 `useUnreadCounts()`를 읽으며, 다른 곳에서 `setAppBadgeCount`/`setTabBadgeCount`를 부르지 않는다(계정 변경 때 지우는 `user-scoped-storage`는 예외).
- 게이트 loader는 아바타를 서명하지 않는다. `avatar_url`은 `AppShellProvider`가 `shellAvatarQuery`로 나중에 채우므로 첫 페인트에는 `null`일 수 있다.
- 모바일 전역 헤더는 없다. 각 page route가 `PageHeader`를 조립하며 이는 `handle.chrome` 설정과 무관하다.
- 모바일 하단 nav와 데스크톱 사이드바는 홈·메시지·그룹·알림·메뉴 다섯 항목(`model/nav-items.ts`)을 공유하며 메뉴는 기존 `/menu` 경로와 도형(`Shapes`) 아이콘을 사용하며 `/settings*`·`/licenses`에서도 활성으로 표시한다. 데스크톱 사이드바의 아이콘 레일과 hover·키보드 포커스 확장 동작은 유지한다.
- `/menu`는 양쪽 화면 모두 제공하며 화면 제목은 메뉴, `handle.chrome.contentWidth`는 `3xl`이다. 학교 기능 다섯 타일은 모바일 2열·데스크톱 4열, 학교 사이트 세 타일은 모바일 2열·데스크톱 3열로 나눈다. 기부물품은 선물(`Gift`) 아이콘으로 `/menu/donations`(헤더만 있는 빈 화면)로 이동한다. `/menu/links`는 호환 리다이렉트 없이 제거한다.
- 홈 route는 학교생활 요약 사이드바를 `lg`(1024px 이상)에서 표시하며 활성 항목을 생일·급식·시간표 순서로 배치한다. 설정의 전체·개별 표시 선택은 app-shell이 소유하고 기본은 모두 켜짐이며 브라우저별·계정 공통으로 저장한다. 전체 OFF일 때 개별 설정 UI는 숨기고 선택은 보존한다. 활성 항목이 없으면 사이드바 영역을 제거하고 기존 피드 열 최대 너비로 중앙 정렬한다. 홈에는 공강·노래방·기부물품 바로가기 줄을 제공하지 않는다. 메뉴 화면의 바로가기와 모바일 홈은 유지한다.
- 홈 생일·급식은 각각의 `Suspense` 경계 밖에서 최소 높이를 확보하고 독립적으로 표시한다. 1024px 미만과 꺼진 항목은 홈 요약 요청을 시작하지 않으며, 화면을 넓히면 활성 항목만 조회하고 피드 세션은 유지한다. 생일의 최소 높이는 빈 상태 안내 기준이며 로딩·인원 목록에는 콘텐츠 높이를 허용한다. 활성 항목은 빈 상태·실패에도 슬롯을 유지하며 구분선은 표시되는 항목 사이에만 둔다. 긴 급식은 생략·내부 스크롤 없이 자연스럽게 늘어난다. 시간표의 캐시 우선 표시와 주말 안내는 유지한다.
- 데스크톱 헤더 아바타는 호버 배경색 변화 없이 내 프로필·설정·관리자 페이지·로그아웃 순서로 제공하며 관리자 페이지는 `profile.role === "admin"`일 때만 표시한다. 포커스 표시와 드롭다운 동작은 유지한다. 바로가기 그룹은 두지 않는다. 학교 사이트 URL·라벨·아이콘은 `model/school-links.ts`가 소유하며 메뉴 홈의 학교 사이트 타일에서 사용한다. 외부 링크는 새 탭으로 연다.
- 데스크톱 전역 헤더에는 공강·노래방 버튼을 두지 않는다. 모바일 홈 급식 버튼은 page route가 그대로 소유한다. 모바일 메뉴 헤더는 관리자 아이콘·설정 버튼·프로필 직접 진입 아바타 순서이며 관리자 아이콘은 `profile.role === "admin"`일 때만 표시하고 "관리자 페이지" 접근성 이름과 툴팁을 제공한다.
- 설정 진입은 `/settings`이며 알림·실험실·비밀번호는 각각 `/settings/noti`, `/settings/lab`, `/settings/password`다. 이전 URL은 호환 리다이렉트 없이 제거한다. 설정 화면에는 관리자 진입점을 두지 않는다. 설정 첫 화면과 관리자 첫 화면의 뒤로가기는 `/menu`, 설정 관련 화면의 뒤로가기는 `/settings`다.
- `PageHeader`는 기본적으로 고정이다. 아래로 스크롤할 때 숨겨야 하는 긴 목록 화면만 `hideOnScroll`을 명시한다.
- `scroll: "page"`(기본) route의 스크롤 컨테이너는 `ScrollRegion`의 `main` 하나이며 window가 아니다. `scroll: "route"`인 메신저는 각 패널이 스크롤을 소유한다.
- `ScrollRegion`의 `main`은 `relative`다. 빼면 위치 기준이 없는 absolute 자손(Base UI 폼 컨트롤의 숨은 input)이 스크롤을 따라오지 않고, 포커스 때 셸 전체가 밀려 올라간다.
- 스크롤 위치 복원은 `ScrollRegion`이 한다. 새 화면은 맨 위, 뒤로·앞으로 가기는 그 기록 항목의 위치이고, `handle.chrome.rememberScroll`인 화면은 탭·링크로 다시 들어와도 마지막 위치로 돌아간다. 같은 경로 안의 이동과 게시물 상세 오버레이는 위치를 건드리지 않는다.
- 이미 있는 탭을 하단 nav에서 다시 누르면 이동하지 않고 스크롤 영역을 맨 위로 올린다. 같은 경로로 다시 이동하면 loader가 돌아 새로고침이 된다.
- 데스크톱에서 홈 첫 화면에 있을 때 사이드바의 홈이나 헤더 로고를 다시 누르면 이동하지 않고 맨 위로 올린 뒤 셸 새로고침을 실행한다. 데스크톱에는 당겨서 새로고침이 없어 피드 새 세션을 여는 유일한 입구다. 다른 탭의 사이드바 재클릭은 기존처럼 같은 경로로 다시 이동한다. 재클릭 판정은 `model/navigation.ts`의 `isTabReselectClick` 하나를 쓰고, 두 홈 링크는 `hooks/use-home-reselect-click.ts`를 공유한다. 다른 화면으로 가는 이동이 loading 중이면 홈 클릭을 가로채지 않는다 — 그 클릭은 진행 중인 이동을 덮어써 홈에 머무르려는 것이다.
- 자동으로 숨는 모바일 하단 nav는 오버레이로 움직이며, 표시 상태가 바뀌어도 `ScrollRegion`의 크기와 스크롤 위치를 바꾸지 않는다.
- 화면 이동 중에는 이전 화면을 유지하고 `NavigationProgress` 막대만 띄운다. 이동이 `layout.tsx`의 `NAVIGATION_SKELETON_DELAY_MS`를 넘길 때만 `Outlet`을 navigation skeleton으로 바꾼다.
- 그룹·프로필 목록 위의 게시물 상세 route를 열고 닫거나, 같은 경로에서 URL 기반 이미지 뷰어·댓글 시트 UI를 여닫는 동안에는 현재 `Outlet`을 navigation skeleton으로 바꾸지 않는다. 부모 화면과 캐시는 이미 유지되고 있으며, 덮어 버리면 모달 이동이 전체 페이지 이동처럼 보인다.
- 당겨서 새로고침은 typed `handle.chrome.pullToRefresh`로 route가 명시적으로 허용하며, 모바일과 태블릿의 터치 입력에서만 시작한다. 입력기·다이얼로그·중첩 스크롤 영역과 데스크톱 마우스·트랙패드에서는 시작하지 않는다. 새로고침 실행·진행 상태·중복 방지는 `hooks/use-shell-refresh.ts`가 소유하고, 당겨서 새로고침과 데스크톱 홈 재클릭이 같은 실행과 표시를 공유한다.
- `AppShellProvider`는 `routes/app/gate.tsx`의 loader data를 받는다. 물리적 route ID에 의존하지 않는다.

`model/types.ts`는 generated database type의 `get_my_profile` 반환형에서 셸에 필요한 필드를
파생한다. `data/queries.ts`는 실제 세션과 프로필 RPC를 읽으며 mock을 사용하지 않는다.
