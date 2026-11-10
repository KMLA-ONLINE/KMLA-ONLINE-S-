# KMLA Online

민사고 학생을 위한 커뮤니티 웹앱. 피드·그룹·메신저·스토리·알림에 급식/시간표 같은 학교
생활 기능을 더한 설치형 PWA입니다.

React Router 8 (SPA, `ssr: false`) · Supabase · shadcn/ui (Base UI) + Tailwind CSS 4 · Vercel

## 시작하기

Node는 `.nvmrc` 버전을, 로컬 Supabase에는 Docker Desktop이 필요합니다.

```bash
npm install
cp .env.example .env.local
npm run db:start      # 출력된 API URL / publishable key를 .env.local에 채움
npm run db:types
npm run dev           # http://localhost:5173
```

## 자주 쓰는 명령

| 명령                           | 설명                                         |
| ------------------------------ | -------------------------------------------- |
| `npm run dev`                  | 개발 서버                                    |
| `npm run check`                | lint + format + typecheck + 문서 검사 + test |
| `npm run verify`               | `check` + 프로덕션 빌드 (CI와 동일)          |
| `npm run fix`                  | ESLint `--fix` + Prettier                    |
| `npm test` / `npm run test:db` | Vitest / pgTAP                               |
| `npm run e2e`                  | Playwright                                   |
| `npm run db:reset`             | migration + seed 재적용                      |
| `npm run db:diff -- <name>`    | `supabase/schemas/` 변경분 → migration       |

전체 목록은 [package.json](package.json)의 `scripts`를 보세요.

## 환경 변수

`VITE_*`는 전부 번들에 박혀 공개됩니다. 시크릿은 넣지 않습니다.

| 변수                             | 필수 | 설명                                                        |
| -------------------------------- | ---- | ----------------------------------------------------------- |
| `VITE_SUPABASE_URL`              | ✓    | Supabase API URL                                            |
| `VITE_SUPABASE_PUBLISHABLE_KEY`  | ✓    | Supabase publishable key                                    |
| `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` |      | Web Push 공개 키 (`npm run web-push:keys`로 생성)           |
| `VITE_SITE_URL`                  |      | 링크 미리보기 `og:image`용 원본. Vercel에서는 자동으로 채움 |

Edge Function 시크릿은 [supabase/.env.example](supabase/.env.example), Vault 시크릿은
[DB 가이드](supabase/README.md#remote-project-secrets)를 참고하세요.

## 환경 (prod / dev)

| Vercel 스코프 | 배포                                                         | Supabase               |
| ------------- | ------------------------------------------------------------ | ---------------------- |
| Production    | `main` push (`release.yml`)                                  | `nvgtzkylunpefdvonioo` |
| Preview       | `dev` push (`deploy-dev.yml`), `dev` 대상 PR (`preview.yml`) | `trftjcieogrewqptgidd` |

Vercel의 Git 자동 배포는 모든 브랜치에서 꺼져 있고(`vercel.json`), 배포는 GitHub Actions만 합니다.
Supabase GitHub 연동(대시보드의 Integrations → GitHub)은 사용하지 않습니다. 연동의 "Deploy to
production"은 `main` push마다 CI보다 먼저 prod에 migration과 Edge Function을
배포하므로 다시 연결하지 않습니다.

secret과 variable은 저장소 단위가 아니라 각 GitHub Environment에 둡니다. job은 자기
Environment의 값만 읽으므로 세 Environment가 같은 이름을 쓰고 값만 다르게 둡니다. 저장소 단위
값은 모든 브랜치의 workflow가 읽고, Environment에 같은 이름이 없을 때 대신 쓰이므로 이 이름들로
만들지 않습니다.

- `SUPABASE_ACCESS_TOKEN`은 Environment마다 해당 프로젝트 하나로 범위를 좁힌 scoped token을
  둡니다. 권한은 Project Settings·API Keys·API Key Secrets 읽기(`supabase link`)와 Edge Functions
  읽기·쓰기입니다. 범위 없는 legacy 토큰은 계정의 모든 프로젝트에 닿습니다.
- Supabase 토큰은 만료 없이(never) 발급합니다. 대신 유출이 의심될 때, 발급한 사람이 역할을
  넘기거나 떠날 때, 저장소 write 권한자가 빠질 때 Supabase 대시보드에서 토큰을 삭제하고 새로
  발급해 해당 Environment의 `SUPABASE_ACCESS_TOKEN`을 갱신합니다. 토큰이 무효가 되면
  `deploy-dev.yml`·`release.yml`이 DB를 건드리기 전 `supabase link` 단계에서 멈추므로, 갱신 후
  실패한 job을 다시 실행합니다.
- Vercel은 프로젝트가 하나이고 토큰 권한을 Preview로 제한할 수 없으므로, 세 Environment의
  `VERCEL_TOKEN`·`VERCEL_ORG_ID`·`VERCEL_PROJECT_ID`는 값도 같습니다. 따라서 `Development`·
  `Preview`의 토큰으로도 Production 배포가 가능하고, `Production` Environment의 브랜치 제한은
  Vercel 배포를 막지 못합니다.

- **dev**: `dev` push → `deploy-dev.yml`이 `ci.yml`을 통과시킨 뒤 migration, Edge Functions,
  `dev` Preview 순으로 배포합니다. `dev` Preview는 `https://dev.kmla.online`에서 열립니다. PR 브랜치는 dev에 push하지 않습니다.
  - `Development` Environment (배포 브랜치 `dev`만)
    - Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` (dev DB), `VERCEL_TOKEN`
    - Variables: `SUPABASE_PROJECT_ID` (`trftjcieogrewqptgidd`), `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- **PR**: `dev` 대상 PR마다 `preview.yml`이 Preview를 배포하고, URL은 vercel[bot] 코멘트에 나옵니다.
  Supabase에 배포되는 파일을 바꾸는 PR은 Preview 대신 `local-review` 라벨을 받고 로컬에서
  리뷰합니다 ([로컬 리뷰](docs/DOCKER.md#10-pr-로컬-리뷰)).
  - `Preview` Environment (배포 브랜치 `main`만): Secret `VERCEL_TOKEN`, Variables
    `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. `pull_request_target`은 기본 브랜치(`main`)에서
    실행되고 Environment 규칙도 `main` 기준으로 검사합니다.
- **prod**: `main` push → `release.yml`이 `ci.yml`을 실행해 통과 → DB migration, Edge Functions,
  Vercel 순으로 GitHub Actions가 배포합니다. 승인 단계는 없고, merge가 곧 배포입니다.
  - `Production` Environment (배포 브랜치 `main`만, required reviewer 없음)
    - Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN`
    - Variables: `SUPABASE_PROJECT_ID`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
  - `main` merge: `Main admins only` ruleset(`main`의 Restrict updates, bypass는 Repository admin의
    pull request뿐)으로 저장소 admin만 할 수 있습니다. PR·merge 방식·필수 체크는 `Main merge` ruleset이
    bypass 없이 모두에게 적용합니다.

- **릴리즈 정리**: `release-dashboard.yml`이 릴리즈 대기 목록 이슈, admin의 `/release` 릴리즈 PR, 릴리즈 후
  태그와 체크리스트 이슈를 만듭니다 ([§5.5](docs/DOCKER.md#55-릴리즈-대기-목록과-릴리즈-pr)).
  - `Release automation` Environment (배포 브랜치 `main`만): Secret `RELEASE_APP_PRIVATE_KEY`,
    Variable `RELEASE_APP_CLIENT_ID`
  - GitHub App: 이 저장소에만 설치하고, 저장소 권한은 Contents 읽기·Pull requests 쓰기만 줍니다.

자세한 절차는 [Supabase 환경 가이드](docs/DOCKER.md)에 있습니다.

## 더 읽을거리

- [문서 안내](docs/README.md) — 작업별 읽기 순서와 문서 작성 규칙
- [소스 구조](docs/structure.md) — 아키텍처와 데이터 접근 규칙
- [Repository Guide](AGENTS.md) — 작업 규칙과 검증 방법 (사람에게도 유효)
- [기능 명세](docs/KMLA_SPEC_INDEX.md) — 도메인별 제품 요구사항
- [Agent Map](docs/AGENT_MAP.md) — 기능별 코드·테스트·RPC 위치
- [DB 가이드](supabase/README.md) — DB 작업 체크리스트
