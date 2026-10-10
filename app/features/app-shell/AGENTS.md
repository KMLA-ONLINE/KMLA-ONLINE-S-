# app-shell feature

로그인한 사용자가 보는 앱 chrome과 bootstrap 데이터를 소유한다. 인증/승인 redirect는
`app/routes/app/gate.tsx`, React Router 레이아웃은 `app/routes/app/layout.tsx`와
`app/routes/messenger/layout.tsx`가 담당한다.

## 불변조건

- `app/routes.ts`가 인증 게이트 아래에 일반 앱과 메신저 layout branch를 명시한다.
- 일반 앱 route는 typed `handle.chrome`으로 전역 헤더와 모바일 하단 nav를 설정한다.
- 일반 앱의 데스크톱 콘텐츠 폭도 `handle.chrome.contentWidth`가 소유한다. 기본은 `model/chrome.ts`의 `DEFAULT_APP_CHROME.contentWidth`(`4xl`)이고, 목록이나 폼처럼 다른 폭이 필요한 route만 명시적으로 override한다.
- 메신저 layout은 데스크톱 전역 헤더를 유지하지만 사이드바와 하단 nav를 렌더하지 않는다.
- 인증/승인 게이트는 `app/routes/app/gate.tsx` 한 곳에만 둔다.
- 셸 loader는 첫 진입과 mutation 이후에만 다시 실행한다. 자식 route의 명시적 revalidation은 셸 프로필을 다시 읽지 않는다.
- 모바일 전역 헤더는 없다. 각 page route가 `PageHeader`를 조립하며 이는 `handle.chrome` 설정과 무관하다.
- `PageHeader`는 기본적으로 고정이다. 아래로 스크롤할 때 숨겨야 하는 긴 목록 화면만 `hideOnScroll`을 명시한다.
- 일반 앱의 스크롤 컨테이너는 `ScrollRegion`의 `main` 하나이며 window가 아니다. 메신저는 각 패널이 스크롤을 소유한다.
- `ScrollRegion`의 `main`은 `relative`다. 빼면 위치 기준이 없는 absolute 자손(Base UI 폼 컨트롤의 숨은 input)이 스크롤을 따라오지 않고, 포커스 때 셸 전체가 밀려 올라간다.
- 스크롤 위치 복원은 `ScrollRegion`이 한다. 새 화면은 맨 위, 뒤로·앞으로 가기는 그 기록 항목의 위치이고, `handle.chrome.rememberScroll`인 화면은 탭·링크로 다시 들어와도 마지막 위치로 돌아간다. 같은 경로 안의 이동과 게시물 상세 오버레이는 위치를 건드리지 않는다.
- 이미 있는 탭을 하단 nav에서 다시 누르면 이동하지 않고 스크롤 영역을 맨 위로 올린다. 같은 경로로 다시 이동하면 loader가 돌아 새로고침이 된다.
- 자동으로 숨는 모바일 하단 nav는 오버레이로 움직이며, 표시 상태가 바뀌어도 `ScrollRegion`의 크기와 스크롤 위치를 바꾸지 않는다.
- 그룹·프로필 목록 위의 게시물 상세 route를 열고 닫거나, 같은 경로에서 URL 기반 이미지 뷰어·댓글 시트 UI를 여닫는 동안에는 현재 `Outlet`을 navigation skeleton으로 바꾸지 않는다. 부모 화면과 캐시는 이미 유지되고 있으며, 덮어 버리면 모달 이동이 전체 페이지 이동처럼 보인다.
- 당겨서 새로고침은 typed `handle.chrome.pullToRefresh`로 route가 명시적으로 허용하며, 모바일과 태블릿의 터치 입력에서만 시작한다. 입력기·다이얼로그·중첩 스크롤 영역과 데스크톱 마우스·트랙패드에서는 시작하지 않는다.
- `AppShellProvider`는 `routes/app/gate.tsx`의 loader data를 받는다. 물리적 route ID에 의존하지 않는다.

`model/types.ts`는 generated database type의 `get_my_profile` 반환형에서 셸에 필요한 필드를
파생한다. `data/queries.ts`는 실제 세션과 프로필 RPC를 읽으며 mock을 사용하지 않는다.
