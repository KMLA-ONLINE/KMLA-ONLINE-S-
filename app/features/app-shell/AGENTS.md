# app-shell feature

로그인한 사용자가 보는 앱 chrome과 bootstrap 데이터를 소유한다. 인증/승인 redirect와 React Router
레이아웃 자체는 `app/routes/_app*.tsx`가 담당한다.

## 불변조건

- 레이아웃은 route `handle`이 아니라 FS route의 pathless prefix로 정한다.
- `_app._document`는 모바일 탭바와 페이지 스크롤을 제공한다.
- `_app._focused`는 탭바 없이 페이지 스크롤을 제공한다.
- `_app._immersive`는 고정 높이만 제공하고 자식 route가 스크롤을 소유한다.
- 인증/승인 게이트는 `app/routes/_app.tsx` 한 곳에만 둔다.
- 셸 loader는 mutation 이후와 명시적 revalidation 때만 다시 실행한다.
- 모바일 전역 헤더는 없다. 각 page route가 `PageHeader`를 조립한다.
- 스크롤 컨테이너는 `ScrollRegion`의 `main` 하나이며 window가 아니다.
- `AppShellProvider`는 `_app.tsx`의 loader data를 받는다. 물리적 route ID에 의존하지 않는다.

`model/types.ts`와 `mock.ts`는 아직 Supabase schema가 없어서 존재한다. schema와 RPC가 추가되면
generated database type에서 모델을 파생하고 `data/queries.ts`만 실제 호출로 교체한 뒤 mock을 삭제한다.
