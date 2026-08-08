```text
app/
  root.tsx
  routes.ts              ← 명시적 route tree
  routes/                ← 기능별로 묶은 얇은 route module
    auth/                ← 로그인, 가입, 초기 설정
    app/
      gate.tsx           ← pathless 인증/승인 게이트 + 셸 데이터 provider
      layout.tsx         ← 일반 앱 셸
      groups/            ← 그룹 route module
      clubs/             ← 동아리 route module
      menu/              ← 메뉴 route module
      profile/           ← 프로필 route module
    messenger/
      layout.tsx         ← 사이드바 없는 메신저 셸
      index.tsx
      room.tsx
  features/
    <feature>/
      AGENTS.md          ← 이 기능의 규칙/불변조건 (선택)
      components/
      context/           ← React context와 provider (선택)
      data/              ← queries · mutations · subscriptions · files. Supabase 호출은 여기서만
      hooks/             ← feature 전용 React hook (선택)
      model/             ← 순수 타입·정책·계산. types.ts는 database.types.ts에서 파생
      storage/           ← localStorage · sessionStorage adapter (선택)
      mock.ts            ← 스키마가 생기면 통째로 지울 파일
      index.ts           ← route와 다른 feature가 쓰는 좁은 public API
  shared/
    ui/                  ← registry-vendored shadcn 원자
    lib/                 ← domain-free utilities와 context
    hooks/
    supabase/            ← client.ts, database.types.ts
    components/          ← domain-free components
test/                    ← Vitest 단위·컴포넌트·라우트 테스트
  features/              ← app/features 구조를 따라 배치
  routes/                ← app/routes 구조를 따라 배치
  router.tsx             ← React Router 테스트 헬퍼
  setup.ts               ← Vitest 전역 설정
e2e/                     ← Playwright E2E 테스트
```

의존성은 `routes → features → shared` 한 방향이다.

- `routes/**`는 `clientLoader`, `clientAction`, URL 파싱, redirect, route error, `Outlet`, 페이지
  chrome 조립만 담당한다.
- `features/**`는 제품 UI, 데이터 접근, 순수 모델, React 상태, 브라우저 storage와 mock을 담당한다.
- `features/**`는 `routes/**`를 import하지 않는다.
- `shared/**`는 `routes/**`나 `features/**`를 import하지 않는다.
- Supabase 호출은 `features/<feature>/data/**`에서만 한다.

Vitest 테스트는 소스 옆에 두지 않고 `test/` 아래에서 대상 코드의 `app/` 구조를 반영한다.
애플리케이션 코드는 `~/*` alias로 import하고, Playwright 테스트는 `e2e/`에 분리한다.

## Route 설정

- URL, pathless layout, index, 동적 segment와 route nesting은 모두 `app/routes.ts`에서 선언한다.
- 일반 앱과 메신저는 인증 게이트 아래의 별도 layout branch다.
- 일반 앱 route는 `handle.chrome`에 `header`와 `bottomNav` 모드를 모두 명시한다.
- 두 모드는 각각 `none`, `sticky`, `hide-on-scroll` 중 하나다.
- `PageHeader`는 페이지 콘텐츠이므로 route chrome 설정에 포함하지 않는다.

## data 층

`data/**`는 아래 네 lifecycle 파일을 기본 진입점으로 사용한다.

- `queries.ts` — 1회 읽기. `clientLoader`에서 부른다.
- `mutations.ts` — 1회 쓰기. `clientAction`에서 부른다.
- `subscriptions.ts` — realtime 채널. `useEffect`에서 부르고 unsubscribe를 반환한다.
- `files.ts` — Supabase Storage. 이벤트 핸들러에서 부르며 업로드와 경로→URL 해석을 맡는다.

작은 feature에서는 `posts.ts`, `comments.ts`처럼 도메인으로 미리 쪼개지 않는다. feature 폴더가 이미
도메인 경계이기 때문이다. 한 lifecycle 파일이 탐색과 변경 단위로 지나치게 커지면 구현을 하위
모듈로 분리할 수 있지만, 외부 진입점은 위 네 파일에 유지한다.

- 파일이 커진 원인이 반복 왕복이나 두꺼운 응답 매핑이라면 파일을 늘리기 전에 RPC 설계를 점검한다.
- `data/**`는 얇은 I/O 껍데기다. 순수 로직은 `model/`이 가진다. `data/**`를 검증하려면 Supabase
  client를 통째로 대역으로 세워야 하므로, 대역 없이 검증할 수 있는 로직은 `model/`에 둔다.
- wire 요청·응답에만 필요한 얇은 변환은 `data/`에 둘 수 있다. 재사용되는 정책, 검증, 계산은
  `model/`로 옮긴다.
- 에러 코드를 사용자 문구로 바꾸는 매핑은 `model/format.ts`다. 입력이 wire라도 출력이 화면이면
  `model/`이다.
- 브라우저 storage(localStorage, sessionStorage)는 Supabase 호출이 아니지만 외부 상태를 다루는
  I/O다. `data/`나 `model/`이 아니라 feature의 `storage/`에 adapter를 둔다.
- React context와 provider는 `context/`, feature 전용 React hook은 `hooks/`에 둔다. `model/`은
  React와 브라우저 API에 의존하지 않는다.
- `mutations.ts`가 `queries.ts`를 import하게 되면 대개 이 경계를 어긴 것이다.

## Supabase 호출

- loader 하나에 RPC 하나를 목표로 한다. SPA + RLS라 왕복 하나하나가 그대로 네트워크다.
- 이 프로젝트의 SPA 성능 전략으로 `queries.ts` 함수는 테이블보다 loader나 화면 use case에 대응한다.
  작성자, 집계, 내 반응은 가능한 한 RPC 안에서 조인해 한 번에 받는다.
- 조인이 SQL에서 끝나므로 읽기에는 소유권이 없다. 다른 feature의 쿼리를 부르지 않는다.
- 쓰기는 다르다. 한 테이블을 수정하는 mutation은 정확히 한 feature의 `mutations.ts`에만 둔다.
- 모델은 생성된 타입에서 파생한다. 손으로 옮겨 담는 매퍼가 두꺼워지면 RPC가 화면 모양이 아니라는 신호다.
