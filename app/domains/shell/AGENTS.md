# shell 도메인

로그인한 사용자가 보는 모든 화면의 바깥 껍데기. 인증 게이트, 셸 데이터, 레이아웃 3종을 소유한다.

## 불변조건

**레이아웃은 `app/routes.ts`상의 위치가 정한다. 라우트 모듈의 `handle`로 정하지 않는다.**

| 레이아웃    | 탭바 | 스크롤             | 쓰는 화면                                              |
| ----------- | ---- | ------------------ | ------------------------------------------------------ |
| `document`  | O    | 페이지가 스크롤    | 피드, 알림, 메뉴, 그룹 목록, 동아리, 관리자, 내 프로필 |
| `focused`   | X    | 페이지가 스크롤    | 그룹 상세, 그룹 생성, 남의 프로필 — 드릴인/폼          |
| `immersive` | X    | 라우트가 직접 소유 | 메신저                                                 |

화면을 추가할 때 물어볼 건 하나다: "탭바가 보이나? 페이지가 스크롤하나?" `document`와 `focused`의
차이는 **탭바 하나뿐**이다.

플래그가 아니라 배치로 정하는 이유: 이전 셸은 `mobileScroll` · `mobileContentEdge` ·
`showMobileHeader` · `mobileSafeAreaTop` · `showMobileTabBar` · `autoHideMobileChrome` 6개 축을
라우트 `handle`로 받았다. 조합 64가지 중 실제로 쓰인 건 4가지였고, 기본값끼리 서로를
참조해서(`mobileSafeAreaTop ?? !showMobileHeader`) 직교하지도 않았다. `match.handle`을 생짜로
캐스팅했기 때문에 오타 난 플래그는 조용히 무시됐다. 지금은 잘못 놓으면 `routes.ts`에서 눈에 보인다.

## 나머지 규칙

- **인증/승인 게이트는 `routes/shell.tsx` 한 곳에만 있다.** 라우트마다 넣으면 정책이 바뀔 때 전부
  고쳐야 한다. `GATE_REDIRECT`가 `Exclude<ProfileStatus, "accepted">`라 상태가 늘면 컴파일이 깨진다.
- **셸 로더는 `shouldRevalidate`로 잠겨 있다.** 레이아웃 로더는 기본적으로 매 내비게이션마다 다시
  도는데, 그러면 페이지 이동마다 RPC 3개가 나간다. 뮤테이션 이후와 명시적
  `useRevalidator().revalidate()` 때만 다시 돈다.
- **모바일 전역 헤더가 없다.** 전역 헤더(`AppHeader`)는 데스크톱 전용이고, 모바일 헤더는 페이지가
  `<PageHeader>`로 자기 스크롤 컨테이너 안에 직접 그린다. 그래서 화면마다 다른 제목·뒤로가기·액션이
  자연스럽게 들어가고 셸에 축이 생기지 않는다.
- **헤더·탭바·사이드바는 `fixed`가 아니라 flex 흐름 안에 있다.** 콘텐츠에 패딩 보정(`pt-14`,
  `pb-[calc(4rem+env(safe-area-inset-bottom))]`)을 붙일 일이 아예 없다. safe-area는 각 컴포넌트가
  자기 것만 처리한다.
- **탭바는 자동 숨김되지 않는다.** 흐름 안에 있어서 사라지면 리플로우가 난다. 위쪽 `PageHeader`만
  숨는다(인스타·트위터 모바일 웹과 같은 동작).
- **모바일 좌우 여백은 0이 기본이다.** 여백이 필요한 페이지가 자기 콘텐츠에 `px-4`를 붙인다.
- **shadcn `SidebarProvider` / `SidebarInset`를 쓰지 않는다.** 그쪽은 자체 높이·flex 가정이 있어서
  `h-dvh` 흐름 셸과 싸운다. `components/app-sidebar.tsx`는 아이콘 레일 + hover 확장을 순수 CSS로
  한다(JS 상태 없음). 접힘 상태를 사용자가 고정하고 싶어지면 그때 상태를 붙인다.
- **`document` 레이아웃이 컨테이너(`max-w-3xl`)를 제공한다.** 전폭이 필요한 페이지는
  `routes/document.tsx`의 한 줄을 바꾸거나 `focused`로 옮긴다.
- **`HydrateFallback`은 `app/root.tsx`에만 둘 수 있다.** SPA 모드에서 다른 라우트에 두면 빌드가
  `SPA Mode: Invalid HydrateFallback export`로 끊긴다. 그래서 셸 골격이 root에 있다.
- **스크롤 컨테이너는 `ScrollRegion`의 `<main>` 하나다.** window가 아니다. 스크롤에 붙는
  것들(sticky 헤더 자동 숨김, 무한 스크롤, 맨 위로)은 `~/shared/lib/scroll-container`의 ref로 같은
  엘리먼트를 잡는다.

## 지금 임시인 것

`model/types.ts`와 `mock.ts`는 **스키마가 없어서** 존재한다. `supabase/migrations/`가 비어 있어
`profiles` 테이블도, `get_my_profile` · `get_unread_message_count` ·
`get_unread_notification_count` RPC도 아직 없다.

마이그레이션이 들어오면 순서는 이렇다.

1. `npm run db:types`로 `app/shared/supabase/database.types.ts`를 재생성한다.
2. `data/queries.ts`의 `loadShellData()` 본문을 그 파일 주석의 실제 RPC 버전으로 바꾼다.
3. `model/types.ts`를 생성된 타입에서 파생시킨다(파일 상단 주석에 코드가 있다).
4. `mock.ts`를 지운다.

`routes/`와 `components/`는 이 과정에서 손대지 않는다 — 그게 `data/`를 분리해 둔 이유다.
