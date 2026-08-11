# app-shell feature

로그인한 사용자가 보는 앱 chrome과 bootstrap 데이터를 소유한다. 인증/승인 redirect와 React Router
레이아웃 자체는 `app/routes/app/layout.tsx`와 `app/routes/messenger/layout.tsx`가 담당한다.

## 불변조건

- `app/routes.ts`가 인증 게이트 아래에 일반 앱과 메신저 layout branch를 명시한다.
- 일반 앱 route는 typed `handle.chrome`으로 전역 헤더와 모바일 하단 nav를 설정한다.
- 메신저 layout은 데스크톱 전역 헤더를 유지하지만 사이드바와 하단 nav를 렌더하지 않는다.
- 인증/승인 게이트는 `app/routes/app/gate.tsx` 한 곳에만 둔다.
- 셸 loader는 mutation 이후와 명시적 revalidation 때만 다시 실행한다.
- 모바일 전역 헤더는 없다. 각 page route가 `PageHeader`를 조립하며 이는 `handle.chrome` 설정과 무관하다.
- 일반 앱의 스크롤 컨테이너는 `ScrollRegion`의 `main` 하나이며 window가 아니다. 메신저는 각 패널이 스크롤을 소유한다.
- `AppShellProvider`는 `routes/app/gate.tsx`의 loader data를 받는다. 물리적 route ID에 의존하지 않는다.

`model/types.ts`와 `mock.ts`는 아직 Supabase schema가 없어서 존재한다. schema와 RPC가 추가되면
generated database type에서 모델을 파생하고 `data/queries.ts`만 실제 호출로 교체한 뒤 mock을 삭제한다.
