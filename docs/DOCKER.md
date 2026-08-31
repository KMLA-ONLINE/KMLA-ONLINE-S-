# Supabase 로컬 개발 환경 설정 가이드

> remote(프로덕션) DB에 직접 붙여 개발하다가 **로컬 환경**으로 전환할 때 필요한 설정을 정리합니다.
> 로컬에서 마음껏 DB를 뜯어고쳐도 프로덕션에 영향이 가지 않도록 환경을 분리하는 것이 목표입니다.

---

## 1. 왜 필요한가

- 프로덕션 DB를 건드리지 않고 스키마 변경, 마이그레이션 실험, Auth 설정 변경 등을 안전하게 할 수 있음
- 팀 협업 환경과 유사한 워크플로우를 경험할 수 있음
- `supabase db pull` / `supabase db push`로 변경 내역을 migration 파일로 관리 가능

---

## 2. 전제 조건

아래 중 하나를 설치하세요:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (macOS, Windows, Linux)
- [Rancher Desktop](https://rancherdesktop.io/) (macOS, Windows, Linux)
- [Podman](https://podman.io/) (macOS, Windows, Linux)
- [OrbStack](https://orbstack.dev/) (macOS)

---

## 3. Supabase CLI 설치

공식 문서: [CLI Quickstart](https://supabase.com/docs/guides/local-development?queryGroups=package-manager&package-manager=brew#quickstart)

```bash
supabase --version
```

최신 버전이 아니라면 업데이트하세요. 버전 차이로 인한 버그를 피하기 위해 항상 최신 CLI를 권장합니다.

---

## 4. 로컬 Supabase 초기화 및 실행

```bash
supabase init
```

`supabase/` 디렉토리와 `config.toml` 등이 생성됩니다. 이 `config.toml`이 로컬 환경 설정의 핵심입니다.

```bash
supabase start
```

실행이 완료되면 터미널에 Studio, API, Database, Auth Keys, Storage 등의 정보가 출력됩니다.
전체 서비스 URL 목록은 아래 **[9. 로컬 서비스 URL 한눈에 보기](#9-로컬-서비스-url-한눈에-보기)** 를 참고하세요.

> 출력되는 모든 값은 **로컬 전용**입니다. remote 프로젝트의 키와 혼동하지 마세요.

---

## 5. 원격 프로젝트 연결

dev(`trftjcieogrewqptgidd`)는 Vercel Preview, prod(`nvgtzkylunpefdvonioo`)는 Production을 받칩니다.

```bash
supabase login
npm run link:dev
```

링크는 dev에 둡니다. 첫 링크 시 DB 비밀번호를 묻고, 비워도 됩니다 (`SUPABASE_DB_PASSWORD`).

### 5.1 dev

`db:*`는 실행 전에 dev로 다시 링크하므로 현재 링크 상태와 무관합니다.

```bash
npm run db:diff:dev      # 드리프트 확인
npm run db:push:dev
npm run fn:secrets:dev
npm run fn:deploy:dev
```

### 5.2 prod

스크립트를 두지 않았습니다. dev에서 확인한 뒤 손으로 칩니다.

```bash
npx supabase link --project-ref nvgtzkylunpefdvonioo
npx supabase db push --linked
npm run link:dev
```

```bash
npx supabase secrets set --project-ref nvgtzkylunpefdvonioo --env-file supabase/.env.prod.local
npx supabase functions deploy --project-ref nvgtzkylunpefdvonioo
```

`db push`에 `--project-ref`가 없어 링크가 곧 대상입니다. 마지막 `link:dev`를 빼먹지 마세요.

> ⚠️ 원격 push에 `--include-seed` 금지 (`seed.sql`은 `auth.users`에 직접 insert),
> `supabase config push` 금지 (`config.toml`의 `site_url`이 로컬 값).

### 5.3 원격 프로젝트를 새로 만들었을 때

마이그레이션이 담지 않는 것 세 가지를 따로 채웁니다.

1. Edge Function 시크릿 — `supabase/.env.example` 참고
2. Vault 시크릿 — `supabase/README.md`의 "Remote project secrets"
3. Auth URL 설정 — Dashboard

그 다음 `supabase/REMOTE_ADMIN_SETUP.md`.

---

## 6. 환경 변수 교체 (remote → local)

로컬 개발을 시작하면 remote 프로젝트의 키는 더 이상 유효하지 않습니다.
아래 명령어로 로컬 키를 확인하세요:

```bash
supabase status
```

`.env.local` 파일에서 다음 값을 교체합니다:

| 변수                            | remote 값                   | local 값                                   |
| ------------------------------- | --------------------------- | ------------------------------------------ |
| `VITE_SUPABASE_URL`             | `https://<ref>.supabase.co` | `http://127.0.0.1:54621`                   |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | remote anon key             | `supabase status`의 local anon key         |
| (필요시) service_role key       | remote secret               | `supabase status`의 local service_role key |

> 로컬 `.env.local`은 항상 로컬 스택을 가리킵니다. 원격 값은 여기 넣지 않습니다 —
> 배포 환경의 값은 Vercel의 Production / Preview 환경변수로 관리합니다. `README.md`의
> "환경 (prod / dev)" 참고.

변경 후 컨테이너를 재시작합니다:

```bash
supabase stop
supabase start
```

---

## 7. Studio 확인

[http://127.0.0.1:54623](http://127.0.0.1:54623) 에 접속하면 로컬 DB를 Studio에서 관리할 수 있습니다.

이미 remote DB에 스키마 변경사항이 있다면 아래 명령어로 로컬로 가져오세요:

```bash
supabase db pull                    # public 스키마
supabase db pull --schema auth      # auth 스키마 (RLS 정책 등)
```

---

## 8. 자주 실수하는 지점

| 상황                  | 설명                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| `supabase link` 실패  | `config.toml`의 설정이 remote와 불일치. 터미널 diff를 보고 맞춘 후 재시도          |
| 로컬에서 auth가 안 됨 | Provider의 콜백 URL에`http://127.0.0.1:54621/auth/v1/callback`이 등록되었는지 확인 |
| "Keys don't match"    | `.env.local`에 아직 remote 키가 남아있음. `supabase status`로 local 키로 교체      |
| Studio가 안 열림      | `supabase start`가 정상 종료되었는지 확인. Docker 데스크탑이 실행 중인지 확인      |
| migration 충돌        | `supabase db pull`로 최신 상태 유지                                                |

---

## 9. 로컬 서비스 URL 한눈에 보기

`supabase start` 실행 후 접속할 수 있는 서비스입니다.

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

> 인증 키(`anon key`, `service_role key`)는 `supabase status` 명령어로 확인하세요.
> 로컬 키는 실행할 때마다 달라질 수 있습니다. 절대 버전 관리에 포함하지 마세요.

---

## 10. 참고 링크

- [Supabase Local Development 공식 문서](https://supabase.com/docs/guides/local-development)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli/introduction)
- [Supabase Auth — Social Login (Google)](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase CLI GitHub Releases](https://github.com/supabase/cli/releases)
