# 소스 구조

이 문서는 코드 배치와 데이터 접근 규칙의 정본이다. 구조가 바뀌면 코드와 이 문서를 같은 변경에서
맞춘다.

```text
app/
  root.tsx               ← document shell. 빌드 타임 렌더에서 브라우저 전역 금지
  routes.ts              ← 명시적 route tree
  routes/                ← 얇은 route module
  features/              ← 제품 코드
  shared/                ← 도메인 없는 코드
test/                    ← Vitest. app/ 구조를 반영
e2e/                     ← Playwright
supabase/tests/          ← pgTAP DB 통합 테스트
```

## 레이어

의존성은 `routes → features → shared` 한 방향이다.

- `routes/**`는 `clientLoader`, `clientAction`, URL 파싱, redirect, route error, `Outlet`, page chrome을
  담당한다.
- `features/**`는 제품 UI, 데이터 접근, 모델, React 상태와 브라우저 storage를 담당한다.
- `shared/**`는 도메인을 모른다.
- 다른 feature는 상대 feature의 `index.ts`만 import한다.
- 애플리케이션 코드는 `~/*` alias를 사용하고 테스트는 `test/` 아래에 둔다.

Supabase 호출은 `features/<feature>/data/**`에서만 한다. ESLint가 모든 내부 경계를 막지는 않으므로
component와 model에서 `getSupabase()`를 부르지 않는다.

## Feature

```text
features/<feature>/
  components/            ← 제품 UI
  model/                 ← 순수 타입·정책·계산
  data/                  ← Supabase I/O
  index.ts               ← 좁은 public API
  context/               ← React context와 provider (선택)
  hooks/                 ← 여러 컴포넌트가 공유하는 feature hook (선택)
  storage/               ← localStorage·sessionStorage adapter (선택)
  mock.ts                ← 스키마 전 임시 데이터 (선택)
  AGENTS.md              ← feature 불변조건 (선택)
```

- `model/types.ts`의 DB 모델은 생성된 `database.types.ts`에서 파생한다.
- `model/`은 React, 브라우저 API와 Supabase에 의존하지 않는다.
- `index.ts`는 route와 다른 feature가 실제로 사용하는 값과 타입만 노출한다.
- feature 내부 모듈과 `mock.ts`는 공개하지 않는다.
- feature 전용 hook은 사용하는 컴포넌트 옆에서 시작하고 공유될 때 `hooks/`로 옮긴다.
- 특정 제품 용어와 정책을 알아야 하는 코드는 `shared/`로 올리지 않는다.

## Data

`data/**`의 기본 진입점은 lifecycle에 따라 나눈다.

- `queries.ts` — 조회. 주로 `clientLoader`에서 호출
- `mutations.ts` — 변경. 주로 `clientAction`에서 호출
- `subscriptions.ts` — realtime 구독. unsubscribe 반환
- `files.ts` — Supabase Storage 업로드와 URL 해석

`data/**`는 얇은 I/O 계층이다. Supabase 대역 없이 검증할 수 있는 로직은 `model/`에 둔다. 에러를
사용자 문구로 바꾸는 작업도 `model/format.ts`가 담당한다.

feature 폴더가 도메인 경계이므로 작은 feature의 data를 미리 세분화하지 않는다. 파일이 커진 원인이
반복 왕복이나 두꺼운 응답 변환이면 파일을 나누기 전에 쿼리와 RPC 모양을 점검한다.

## 읽기

- loader에서 의존적 왕복과 항목별 조회를 만들지 않는다.
- 독립 호출은 `Promise.all`로 병렬 실행한다.
- query 함수는 테이블 저장소가 아니라 화면 use case를 표현한다.
- 단순 조회는 table API와 RLS를 사용한다.
- table API로 표현하기 어렵거나 여러 화면에서 같은 SQL을 재사용하면 `security invoker` RPC 또는
  `security_invoker = true` view를 사용한다.
- RPC와 view는 화면에 필요한 열만 반환한다.
- 다른 feature의 query를 호출하지 말고 필요한 조인은 같은 읽기 경로에서 끝낸다.

화면 전체를 읽는 loader는 mutation 뒤 갱신 전략을 명시한다.

- loader를 재검증하거나,
- mutation이 canonical 결과를 반환해 화면 상태에 병합하거나,
- optimistic update 후 실패 시 복구한다.

`shouldRevalidate`로 재조회를 막으면서 대체 갱신 경로를 두지 않는다.

## 쓰기

- table API로 충분한 변경은 RLS 아래 직접 수행한다.
- 여러 행의 불변조건과 원자성이 필요하면 `security invoker` RPC를 사용한다.
- direct mutation과 RPC를 포함해 한 테이블의 변경은 하나의 feature가 소유한다.
- 클라이언트 입력으로 사용자 ID, 역할과 권한을 신뢰하지 않는다.
- 클라이언트 검증은 UX다. 유일성, 상태 전이, 소유권과 교차 행 불변조건은 DB constraint, trigger 또는
  transaction RPC가 강제한다.

## 인가와 민감 정보

- 브라우저가 접근하는 모든 테이블은 같은 migration에서 grant와 RLS policy를 정의한다.
- 일반 목록과 상세 읽기에 `security definer`를 사용하지 않는다.
- 익명·가명 기능에서 실제 신원의 공개 여부가 행마다 달라지면 RLS가 아니라 스키마 분리로 해결한다.
- 이 경우 클라이언트가 읽는 행에는 표시 정보만 두고 실제 신원은 table grant가 없는 `private` 스키마에
  둔다.
- 익명 표시값은 쓰기 시점에 확정하며 일반 읽기 경로가 실제 신원을 참조하지 않게 한다.

`security definer`는 다음의 좁은 경계에만 사용한다.

- `private.*`를 읽거나 쓰는 mutation
- 반환값에 신원을 포함하지 않는 운영 조치
- 본인에게만 반환하는 민감 조회
- RLS 자기 참조를 끊는 `private.*` policy helper
- 일반 사용자 권한으로 수행할 수 없는 제한된 trigger helper

definer 함수는 `set search_path = ''`을 사용하고 호출자를 다시 검증한다. broad 목록이나 화면 전체를
반환하지 않는다. `PUBLIC`, `anon`과 불필요한 role의 `EXECUTE`를 회수하고 필요한 role에만 명시적으로
grant한다.

## 집계

집계는 우선 정규화된 데이터에서 계산한다. 측정된 읽기 비용이 문제가 될 때만 비정규화한다.

비정규화한 카운터에는 다음이 필요하다.

- 같은 transaction에서 값을 유지하는 trigger 또는 mutation
- 원본에서 다시 계산하는 복구 방법
- 동시 쓰기와 삭제를 포함한 DB 테스트

## DB 테스트

RLS와 DB 불변조건은 실제 DB role로 table API와 RPC를 호출하는 통합 테스트로 검증한다. 모든 쿼리를
테스트하지 않고 다음 경계를 우선한다.

- 역할과 사용자 유형별 허용·거부
- 공개·비공개 행 가시성
- 소유권과 유일성 제약
- trigger와 상태 전이
- 동시성 또는 원자성이 필요한 RPC
- `private.*` grant와 definer 반환 타입

DB 테스트는 `supabase/tests/*.sql`에 두고 `npm run test:db`로 실행한다. CI는 migration과 seed를 reset한
로컬 Supabase에서 이 테스트를 실행한다.

## Realtime과 Storage

realtime은 테이블 행을 전달하고 RPC는 화면 모양을 반환한다. 기본은 이벤트를 신호로 사용해 loader를
재검증하는 것이다. 이벤트 병합이 필요하면 순수 병합 함수를 `model/`에 두고 테스트한다.

Storage는 테이블 RLS와 별도의 인가면이다. 새 버킷은 정책과 같은 migration에 추가하고
`docs/STORAGE_BUCKETS.md`의 경로와 서명 URL 규칙을 따른다.

## Route

- URL과 route nesting은 `app/routes.ts`에서만 선언한다.
- runtime server가 없으므로 `clientLoader`와 `clientAction`을 사용한다.
- 일반 앱 route는 typed `handle.chrome`에 `header`와 `bottomNav`를 명시한다.
- `PageHeader`는 route가 조립하는 페이지 콘텐츠다.
- `root.tsx`의 import graph는 빌드 타임 렌더에서 브라우저 전역과 eager Supabase client를 사용하지 않는다.
