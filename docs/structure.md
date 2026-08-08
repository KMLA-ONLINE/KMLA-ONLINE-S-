```text
app/
  root.tsx
  routes.ts              ← `flatRoutes()` 설정만 둔다
  routes/                ← FS convention 기반의 얇은 route module
    _app.tsx             ← pathless 앱 셸 + 인증/승인 게이트
    _app._document.tsx   ← pathless 문서형 레이아웃
    _app._focused.tsx    ← pathless 집중형 레이아웃
    _app._immersive.tsx  ← pathless 앱형 레이아웃
    ...
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

## FS route 이름

- `_leading`: URL segment가 없는 pathless layout이다.
- `.`: URL segment와 route nesting을 만든다.
- `$param`: 동적 URL segment다.
- trailing `_`: URL은 중첩하지만 같은 이름의 부모 UI에는 중첩하지 않는다.
- `_index`: 부모의 index route다.
- `$`: catch-all route다.

레이아웃은 `handle`이 아니라 파일명의 `_document`, `_focused`, `_immersive` pathless prefix로 정한다.
예를 들어 `groups_.discover.tsx`는 `/groups/discover` URL을 만들지만 `/groups` 화면의 `Outlet`에는
들어가지 않는다.
