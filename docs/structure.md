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
      data/              ← queries.ts, mutations.ts. Supabase 호출은 여기서만
      model/             ← types.ts(database.types.ts 파생), format.ts, constants.ts
      mock.ts            ← 스키마가 생기면 통째로 지울 파일
      index.ts           ← route와 다른 feature가 쓰는 좁은 public API
  shared/
    ui/                  ← registry-vendored shadcn 원자
    lib/                 ← domain-free utilities와 context
    hooks/
    supabase/            ← client.ts, database.types.ts
    components/          ← domain-free components
```

의존성은 `routes → features → shared` 한 방향이다.

- `routes/**`는 `clientLoader`, `clientAction`, URL 파싱, redirect, route error, `Outlet`, 페이지
  chrome 조립만 담당한다.
- `features/**`는 제품 UI, 데이터 접근, 모델, feature hook과 mock을 담당한다.
- `features/**`는 `routes/**`를 import하지 않는다.
- `shared/**`는 `routes/**`나 `features/**`를 import하지 않는다.
- Supabase 호출은 `features/<feature>/data/**`에서만 한다.

## Route 설정

- URL, pathless layout, index, 동적 segment와 route nesting은 모두 `app/routes.ts`에서 선언한다.
- 일반 앱과 메신저는 인증 게이트 아래의 별도 layout branch다.
- 일반 앱 route는 `handle.chrome`에 `header`와 `bottomNav` 모드를 모두 명시한다.
- 두 모드는 각각 `none`, `sticky`, `hide-on-scroll` 중 하나다.
- `PageHeader`는 페이지 콘텐츠이므로 route chrome 설정에 포함하지 않는다.
