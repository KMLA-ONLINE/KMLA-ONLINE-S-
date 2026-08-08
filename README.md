# KMLA Online v2

Facebook 형태의 커뮤니티 웹앱. **SPA로 동작하는 PWA**이며 Vercel에 정적 배포됩니다.

## 스택

| 영역                 | 선택                                            | 비고                          |
| -------------------- | ----------------------------------------------- | ----------------------------- |
| 라우팅/빌드          | React Router 8 (framework mode, `ssr: false`)   | Vite 8                        |
| 백엔드               | Supabase (Postgres + Auth + Realtime + Storage) | 로컬은 Supabase CLI           |
| UI                   | shadcn/ui (Base UI) + Tailwind CSS 4            | preset `vega`, Lucide + Inter |
| 유닛/컴포넌트 테스트 | Vitest 4 + React Testing Library                | jsdom                         |
| E2E                  | Playwright                                      | 프로덕션 빌드 대상            |
| PWA                  | Workbox (`workbox-build` 후처리)                | 설치 가능 + 앱 셸 precache    |
| 배포                 | Vercel (정적 + SPA rewrite)                     |                               |

## 요구사항

- **Node** — `.nvmrc`가 24.18.1을 고정합니다 (CI도 이 파일을 읽습니다).
  `engines`의 `>=22.22.0`은 React Router 8의 실제 최소 요구치이고, `.nvmrc`는 개발/CI에서
  실제로 쓰는 버전입니다. 둘은 다른 의미이니 함께 봐주세요.
- Docker Desktop (로컬 Supabase 스택)

## 시작하기

```bash
npm install
cp .env.example .env.local

npm run db:start      # 로컬 Supabase 기동 (Docker 필요)
npm run db:types      # DB 스키마 -> TypeScript 타입 생성
npm run dev           # http://localhost:5173
```

`db:start` 출력의 `API URL` / publishable key를 `.env.local`에 채워 넣습니다.

## 스크립트

| 명령                                         | 설명                                           |
| -------------------------------------------- | ---------------------------------------------- |
| `npm run dev`                                | 개발 서버 (서비스 워커 비활성)                 |
| `npm run build`                              | SPA 빌드 + 서비스 워커 생성                    |
| `npm run preview`                            | 빌드 결과를 로컬에서 서빙                      |
| `npm run typecheck`                          | 라우트 타입 생성 후 `tsc`                      |
| `npm test` / `test:watch` / `test:coverage`  | Vitest                                         |
| `npm run e2e` / `e2e:ui`                     | Playwright (빌드 후 자동 서빙)                 |
| `npm run db:start` / `db:stop` / `db:status` | 로컬 Supabase                                  |
| `npm run db:reset`                           | 마이그레이션 + seed 재적용                     |
| `npm run db:diff -- <name>`                  | 로컬 변경분을 마이그레이션 파일로 추출         |
| `npm run db:types`                           | `app/shared/supabase/database.types.ts` 재생성 |
| `npm run pwa:assets`                         | `public/logo.svg`에서 아이콘 일체 재생성       |
| `npm run lint` / `lint:fix`                  | ESLint                                         |
| `npm run format` / `format:check`            | Prettier                                       |
| `npm run check`                              | lint + format + typecheck + test 일괄          |
| `npm run verify`                             | `check` + 프로덕션 빌드 (CI가 실행하는 것)     |
| `npm run e2e:install`                        | Playwright 브라우저 5종 설치                   |

## 아키텍처에서 반드시 알아야 할 것

### 1. 서버가 없습니다

`react-router.config.ts`의 `ssr: false` 때문에 런타임 서버가 존재하지 않습니다.

- **`loader` / `action`을 쓸 수 없습니다.** `clientLoader` / `clientAction`만 사용합니다.
- **모든 인가는 Postgres RLS가 담당합니다.** 클라이언트 코드로 막는 것은 UX일 뿐 보안이 아닙니다.
  새 테이블을 만들 때마다 RLS 정책을 같은 마이그레이션에 함께 넣으세요.
- `.env`의 `VITE_*` 값은 전부 번들에 박혀 공개됩니다. `service_role` 키를 절대 넣지 마세요.
- **루트 라우트는 SSR-safe해야 합니다.** `app/root.tsx`의 `Layout`은 빌드 타임에 렌더되어
  `build/client/index.html`을 만듭니다. 여기서 `window` / `localStorage`를 만지면 빌드가 깨집니다.
  같은 이유로 `getSupabase()`는 지연 생성되며 브라우저에서만 호출 가능합니다.

서버 로직이 필요해지면(웹훅, 서드파티 시크릿, 관리자 작업) Supabase Edge Functions로 보내고
SPA 모드를 유지하는 것이 이 구조와 일관됩니다.

### 2. 서비스 워커는 Vite 플러그인이 아니라 빌드 후처리로 만듭니다

React Router의 SPA 빌드는 여러 Vite 환경으로 나뉘어 실행되고 `index.html`은 모든 플러그인의
`closeBundle` 이후 prerender 단계에서 생성됩니다. 그래서 `vite-plugin-pwa`는 빈 디렉터리를
globbing 하게 됩니다 ([vite-pwa/vite-plugin-pwa#809](https://github.com/vite-pwa/vite-plugin-pwa/issues/809)).

대신 `scripts/build-sw.mjs`가 완성된 `build/client`를 대상으로 `workbox-build`를 직접 실행합니다.
`npm run build`에 체이닝되어 있으므로 별도로 호출할 필요는 없습니다.

- `index.html`이 precache에 포함되고 navigation fallback으로 바인딩됩니다 (딥링크 오프라인 동작).
- **폰트는 precache에 넣지 않습니다.** Pretendard는 한글 글리프 전체가 단일 ~750 kB 파일이라
  설치 시점 다운로드가 두 배 이상으로 불어납니다. 대신 `runtimeCaching`의 CacheFirst로
  `fonts` 캐시에 담습니다 (파일명이 해시라 stale 위험 없음). 대가는 최초 1회 렌더에서
  시스템 폰트로 잠깐 보일 수 있다는 것뿐입니다.
- `skipWaiting: false`이므로 새 버전은 사용자가 수락할 때까지 대기합니다
  (`app/shared/hooks/use-service-worker.ts` → `app/shared/components/update-prompt.tsx`).
- 개발 서버에는 서비스 워커가 등록되지 않습니다 (`import.meta.env.PROD` 가드).

### 3. 테스트에서는 React Router Vite 플러그인을 쓰지 않습니다

`vitest.config.ts`는 `reactRouter()` 플러그인을 포함하지 않습니다. 이 플러그인은 typegen과
가상 서버 모듈을 포함한 프레임워크 그래프를 구성하는데 Vitest 환경에서 동작하지 않습니다.
대신 `test/router.tsx`의 `renderRoute()`가 `createRoutesStub`으로 라우터 컨텍스트를 만듭니다.
Vitest 테스트는 `test/` 아래에 두고 `app/`의 영역 구조를 따라 배치합니다. Playwright 테스트는
별도의 `e2e/`에 둡니다.

```tsx
// test/routes/theme.test.tsx
import Theme from "~/routes/theme";
import { renderRoute, screen } from "../router";

renderRoute(Theme, { path: "/theme" });
```

`createRoutesStub`은 `clientLoader` 키를 모르므로, 로더를 직접 태우고 싶다면 `loader`로 넘기세요.

Vitest는 `globals: false`입니다. Playwright의 `expect`와 타입이 충돌하지 않도록
`describe` / `it` / `expect`를 명시적으로 import 합니다.

### 4. Git 훅

husky가 두 단계로 나눠 겁니다.

| 훅           | 실행                                      | 이유                        |
| ------------ | ----------------------------------------- | --------------------------- |
| `pre-commit` | `lint-staged` (ESLint `--fix` + Prettier) | 스테이지된 파일만 — 수 초   |
| `pre-push`   | `npm run typecheck && npm test`           | 전체 프로그램이 필요한 검사 |

타입 에러와 깨진 테스트는 대개 이번 커밋이 건드리지 않은 파일에 있으므로 부분 파일 목록으로는
잡히지 않습니다. 그래서 commit이 아니라 push에 걸었습니다.

`.lintstagedrc.mjs`의 `--no-warn-ignored`는 필수입니다. lint-staged는 ESLint에 파일 경로를 직접
넘기는데, `globalIgnores` 대상(`app/shared/ui/**`, `database.types.ts`)이 스테이지되면
"ignored" 경고가 나고 `--max-warnings 0` 때문에 커밋이 실패합니다.

훅을 한 번 건너뛰려면 `HUSKY=0 git commit ...` 또는 `git commit --no-verify`.

`.gitattributes`가 `eol=lf`를 강제합니다 — Prettier가 LF로 쓰는데 Windows 체크아웃이 CRLF로
바꾸면 `format:check`가 매번 실패합니다.

### 5. CI

`.github/workflows/quality.yml`이 `npm run verify`를, `playwright.yml`이 E2E를 돌립니다.
둘 다 `.nvmrc`로 Node 버전을 맞춥니다.

E2E 워크플로는 러너에서 `supabase start`로 로컬 스택을 띄운 뒤,
**URL과 키를 하드코딩하지 않고 `supabase status -o env`에서 읽어옵니다.**
`supabase/config.toml`의 포트를 바꿔도 CI가 어긋나지 않게 하기 위함입니다.

### 6. 에이전트 MCP

`.mcp.json`에 두 서버가 정의돼 있습니다.

| 서버       | 엔드포인트                       |
| ---------- | -------------------------------- |
| `shadcn`   | `npx shadcn mcp`                 |
| `supabase` | `http://127.0.0.1:54623/api/mcp` |

로컬 Supabase MCP는 **Studio 포트의 `/api/mcp`**입니다 —
`supabase status`가 보여주는 `MCP_URL`(API 포트 + `/mcp`)이 아닙니다. 그쪽은 400을 반환합니다.
`supabase/config.toml`의 `studio.port`를 바꾸면 이 URL도 함께 고쳐야 합니다.

스택이 떠 있어야 동작하며(`npm run db:start`), 클라이언트에서 서버 승인이 한 번 필요합니다.

## 배포 (Vercel)

`vercel.json`이 정적 출력(`build/client`)과 SPA rewrite를 정의합니다.
`@vercel/react-router` preset은 사용하지 않습니다 — peer가 아직 `@react-router/dev: 7`에 묶여 있고,
SPA 모드에서 그 preset의 이점(라우트별 함수 설정, 번들 스플리팅)은 모두 SSR용이라 해당 사항이 없습니다.

Vercel 프로젝트 환경변수에 `VITE_SUPABASE_URL`과 `VITE_SUPABASE_PUBLISHABLE_KEY`를 등록해야 합니다.

## 알려진 제약

- **SEO / OG 미리보기 없음.** 모든 경로가 동일한 `index.html`을 받으므로 링크 공유 시 카드
  미리보기가 생성되지 않습니다. 공개 프로필·게시물 공유가 중요해지면 해당 경로만
  `prerender`로 돌리거나 별도 OG 이미지 엔드포인트가 필요합니다.
- 오프라인 범위는 **앱 셸까지**입니다. 피드 데이터는 항상 네트워크를 탑니다.
