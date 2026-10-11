# Supabase 개발·배포 환경 가이드

이 저장소를 clone한 개발자가 로컬 Supabase를 실행하고 dev/prod 환경을 구분하기 위한 가이드입니다.
DB 변경과 migration 검토 절차의 정본은 [Database workflow](../supabase/README.md)입니다.

---

## 1. 왜 필요한가

- 프로덕션 DB를 건드리지 않고 스키마 변경, 마이그레이션 실험, Auth 설정 변경 등을 안전하게 할 수 있음
- 팀 협업 환경과 유사한 워크플로우를 경험할 수 있음
- 선언적 schema와 검토된 migration을 로컬에서 재현하고 검증할 수 있음

---

## 2. 전제 조건

Node는 [`.nvmrc`](../.nvmrc)의 버전을 사용하고
[Docker Desktop](https://www.docker.com/products/docker-desktop/)을 실행합니다.
이 프로젝트의 로컬 개발 기준은 Docker Desktop이며 다른 컨테이너 런타임은 검증된 대안으로 안내하지 않습니다.

---

## 3. 저장소 CLI 준비

저장소 루트에서 의존성을 설치합니다. CLI는 devDependency이며 npm script는 설치된 CLI를 사용합니다.

```bash
npm install
npx supabase --version
```

전역 CLI 대신 npm script 또는 `npx supabase`를 사용합니다. CI는 `npm ci`로
`package-lock.json`의 버전을 설치합니다. CLI를 업그레이드할 때는 manifest와 lockfile 변경을
함께 검토하고 [DB 검증 절차](../supabase/README.md#ddl-changes)를 수행합니다.

---

## 4. 로컬 Supabase 실행

```bash
cp .env.example .env.local
npm run db:start
```

기존 `.env.local`이 있으면 복사로 덮어쓰지 말고 §6의 로컬 값을 확인합니다.
저장소에 [supabase/config.toml](../supabase/config.toml), schema, migration이 이미 있으므로
`supabase init`은 실행하지 않습니다. init은 새 프로젝트를 만들 때 쓰는 명령입니다.
`db:start`가 출력한 API URL과 publishable key를 `.env.local`에 채운 뒤 다음을 실행합니다.

```bash
npm run db:types
npm run dev
```

`db:start` 실행이 완료되면 터미널에 Studio, API, Database, Auth Keys, Storage 등의 정보가 출력됩니다.
전체 서비스 URL 목록은 아래 **[9. 로컬 서비스 URL 한눈에 보기](#9-로컬-서비스-url-한눈에-보기)** 를 참고하세요.

> 출력되는 모든 값은 **로컬 전용**입니다. remote 프로젝트의 키와 혼동하지 마세요.

---

## 5. 원격 프로젝트 연결

dev(`trftjcieogrewqptgidd`)는 Vercel Preview, prod(`nvgtzkylunpefdvonioo`)는 Production을 받칩니다.

```bash
npx supabase login
npm run link:dev
```

링크는 dev에 둡니다. 첫 링크 시 DB 비밀번호를 묻고, 비워도 됩니다 (`SUPABASE_DB_PASSWORD`).

### 5.1 dev

`db:diff:dev`와 `db:push:dev`는 실행 전에 dev로 다시 링크하므로 현재 링크 상태와 무관합니다.
로컬 `db:*` 명령은 원격 링크를 바꾸지 않습니다.

```bash
npm run db:diff:dev      # 드리프트 확인
npm run db:push:dev
npm run fn:secrets:dev
npm run fn:deploy:dev
```

### 5.2 prod

`main` push의 품질 검사가 통과하면 GitHub `Production` Environment 승인을 기다립니다. 승인 후
GitHub Actions가 migration, 모든 Edge Function, Vercel Production을 순서대로 배포합니다.
필요한 secret/variable과 reviewer 설정은 [README의 환경 표](../README.md#환경-prod--dev)에 있습니다.
GitHub `Production` Environment에 required reviewers를 설정해야 승인 대기가 적용됩니다.
에이전트는 prod 쓰기나 릴리스 승인·실행을 하지 않으며 dev 검증 결과를 사용자에게 전달합니다.
일반 배포에서는 수동 prod push로 이 절차를 우회하지 않습니다.

첫 승인 전에는 운영 DB를 백업하고 migration history와 실제 스키마가 저장소와 정렬되었는지
확인합니다. 기존 스키마의 버전을 검증 없이 `migration repair`로 일괄 등록하지 않습니다.
Function/Vault 시크릿과 Auth URL은 릴리스 workflow가 변경하지 않습니다.

> ⚠️ 원격 push에 `--include-seed` 금지 (`seed.sql`은 `auth.users`에 직접 insert),
> `supabase config push` 금지 (`config.toml`의 `site_url`이 로컬 값).

### 5.3 원격 프로젝트를 새로 만들었을 때

마이그레이션이 담지 않는 것 세 가지를 따로 채웁니다.

1. Edge Function 시크릿 — [supabase/.env.example](../supabase/.env.example) 참고
2. Vault 시크릿 — [Remote project secrets](../supabase/README.md#remote-project-secrets)
3. Auth URL 설정 — Dashboard

그 다음 [원격 최초 관리자 설정](../supabase/REMOTE_ADMIN_SETUP.md)을 따릅니다.

---

## 6. 환경 변수 교체 (remote → local)

로컬 앱에는 remote 키 대신 로컬 스택의 URL과 키를 사용합니다. 환경을 바꿔도 remote 키 자체가
폐기되는 것은 아닙니다. 아래 명령어로 로컬 값을 확인하세요:

```bash
npm run db:status
```

`.env.local` 파일에서 다음 값을 교체합니다:

| 변수                            | remote 값                   | local 값                                           |
| ------------------------------- | --------------------------- | -------------------------------------------------- |
| `VITE_SUPABASE_URL`             | `https://<ref>.supabase.co` | `http://127.0.0.1:54621`                           |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | remote publishable key      | `npm run db:status`에 표시된 local publishable key |

`service_role` 또는 secret key는 프런트엔드 설정이 아닙니다. `VITE_*`에는 절대 넣지 않습니다.
Edge Function 전용 값은 [supabase/.env.example](../supabase/.env.example)을 참고합니다.

> 로컬 `.env.local`은 항상 로컬 스택을 가리킵니다. 원격 값은 여기 넣지 않습니다 —
> 배포 환경의 값은 Vercel의 Production / Preview 환경변수로 관리합니다. `README.md`의
> [환경 (prod / dev)](../README.md#환경-prod--dev) 참고.

앱의 `.env.local`을 바꿨다면 실행 중인 Vite 개발 서버를 종료하고 다시 시작합니다.
Supabase 컨테이너를 재시작할 필요는 없습니다.

```bash
npm run dev
```

---

## 7. Studio 확인

[http://127.0.0.1:54623](http://127.0.0.1:54623) 에 접속하면 로컬 DB를 Studio에서 관리할 수 있습니다.

### DB 변경과 원격 드리프트

Studio에서 한 변경만 남기지 않습니다. DDL은 `supabase/schemas/`를 먼저 수정하고,
`npm run db:diff -- <name>`으로 migration 초안을 만든 뒤 전문 검토·로컬 적용·검증을 수행합니다.
전체 순서와 diff에 담기지 않는 변경은 [DB 가이드](../supabase/README.md#ddl-changes)를 따릅니다.

`db pull`은 원격 DB를 로컬에 적용하는 동기화 명령이 아닙니다. migration 파일을 만들고
선택에 따라 원격 migration history도 변경하므로 일반 개발·충돌 해결 절차에서 사용하지 않습니다.
원격에만 있는 변경을 받아야 한다면 먼저 대상 환경·migration history·실제 schema를 확인하고
담당자와 수용 범위를 결정한 뒤 선언적 원본과 migration을 함께 정렬합니다. 운영 DB의 baseline과
history 조정은 [원격 DB 절차](../supabase/README.md#remote-projects)의 별도 검토 대상입니다.

---

## 8. 자주 실수하는 지점

| 상황                  | 설명                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| 원격 연결 실패        | 대상 project ref, 인증 토큰과 DB 비밀번호를 확인. 원격에 맞추려고 로컬 config를 자동 덮어쓰지 않음 |
| 로컬에서 auth가 안 됨 | Provider의 콜백 URL에`http://127.0.0.1:54621/auth/v1/callback`이 등록되었는지 확인                 |
| "Keys don't match"    | `.env.local`의 URL과 key가 같은 로컬 프로젝트 값인지 `npm run db:status`로 확인                    |
| Studio가 안 열림      | `npm run db:start`의 성공 여부와 Docker Desktop 실행 상태 확인                                     |
| migration 충돌        | 저장소 migration 이력과 schemas를 비교하고 DB 가이드에 따라 검토. `db pull`로 자동 해결하지 않음   |

---

## 9. 로컬 서비스 URL 한눈에 보기

`npm run db:start` 실행 후 접속할 수 있는 서비스입니다. 포트의 정본은
[supabase/config.toml](../supabase/config.toml)입니다.

| 구분 | 서비스                | URL                                                       |
| ---- | --------------------- | --------------------------------------------------------- |
| 🔧   | Studio                | http://127.0.0.1:54623                                    |
| 🔧   | Mailpit (이메일 확인) | http://127.0.0.1:54624                                    |
| 🌐   | Project URL           | http://127.0.0.1:54621                                    |
| 🌐   | REST API              | http://127.0.0.1:54621/rest/v1                            |
| 🌐   | GraphQL               | http://127.0.0.1:54621/graphql/v1                         |
| 🌐   | Edge Functions        | http://127.0.0.1:54621/functions/v1                       |
| ⛁    | Database (직접 연결)  | `postgresql://postgres:postgres@127.0.0.1:54622/postgres` |
| 📦   | Storage S3            | http://127.0.0.1:54621/storage/v1/s3                      |

> 인증 키는 `npm run db:status`로 확인하세요. 프런트엔드에는 publishable key만 사용합니다.
> 로컬 키는 실행할 때마다 달라질 수 있습니다. 절대 버전 관리에 포함하지 마세요.

---

## 10. 참고 링크

- [Supabase Local Development 공식 문서](https://supabase.com/docs/guides/local-development)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli/introduction)
- [Supabase Auth — Social Login (Google)](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase CLI GitHub Releases](https://github.com/supabase/cli/releases)
