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

| 명령                           | 설명                                   |
| ------------------------------ | -------------------------------------- |
| `npm run dev`                  | 개발 서버                              |
| `npm run check`                | lint + format + typecheck + test       |
| `npm run verify`               | `check` + 프로덕션 빌드 (CI와 동일)    |
| `npm run fix`                  | ESLint `--fix` + Prettier              |
| `npm test` / `npm run test:db` | Vitest / pgTAP                         |
| `npm run e2e`                  | Playwright                             |
| `npm run db:reset`             | migration + seed 재적용                |
| `npm run db:diff -- <name>`    | `supabase/schemas/` 변경분 → migration |

전체 목록은 `package.json`의 `scripts`를 보세요.

## 환경 변수

`VITE_*`는 전부 번들에 박혀 공개됩니다. 시크릿은 넣지 않습니다.

| 변수                             | 필수 | 설명                                                        |
| -------------------------------- | ---- | ----------------------------------------------------------- |
| `VITE_SUPABASE_URL`              | ✓    | Supabase API URL                                            |
| `VITE_SUPABASE_PUBLISHABLE_KEY`  | ✓    | Supabase publishable key                                    |
| `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` |      | Web Push 공개 키 (`npm run web-push:keys`로 생성)           |
| `VITE_SITE_URL`                  |      | 링크 미리보기 `og:image`용 원본. Vercel에서는 자동으로 채움 |

Edge Function 시크릿은 `supabase/.env.example`, Vault 시크릿은 `supabase/README.md`를 참고하세요.

## 환경 (prod / dev)

| Vercel 스코프 | 브랜치      | Supabase               |
| ------------- | ----------- | ---------------------- |
| Production    | `main`      | `nvgtzkylunpefdvonioo` |
| Preview       | `dev` 및 PR | `trftjcieogrewqptgidd` |

- **dev**: `npm run db:push:dev`, `fn:secrets:dev`, `fn:deploy:dev`로 직접 배포합니다.
- **prod**: `main` push → `Quality Checks` 통과 → GitHub `Production` Environment 승인 →
  DB migration, Edge Functions, Vercel 순으로 GitHub Actions가 배포합니다.
  - Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN`
  - Variables: `SUPABASE_PROJECT_ID`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
  - Reviewer: `cjeonguk`, `kmlaswtech`, `survibo` 중 한 명

자세한 절차는 `docs/DOCKER.md`에 있습니다.

## 더 읽을거리

- `AGENTS.md` — 구조, 규칙, 검증 방법 (사람에게도 유효)
- `docs/KMLA_SPEC_INDEX.md` — 기능 명세 진입점
- `docs/AGENT_MAP.md` — 기능별 코드·테스트 위치
- `supabase/README.md` — DB 작업 체크리스트
