# 알림 전달 파이프라인 점검

알림이 오지 않을 때 어느 단계에서 끊겼는지 순서대로 좁히기 위한 문서다. 설계 정본은
`NOTIFICATION_TECHNICAL_DESIGN.md`, 브라우저와 OS를 거치는 인수 테스트는
`NOTIFICATION_MANUAL_TESTING.md`를 따른다. 이 문서는 서버 쪽 진단만 다룬다.

## 파이프라인

```
트리거(댓글·답글·가입 승인 등)
  → public.notifications
  → private.enqueue_notification_push / private.enqueue_notification_email   ← 여기서 이미 걸러진다
  → private.notification_delivery_outbox (status = pending)
  → pg_cron 'dispatch-notifications-every-30-seconds' (30초)
  → private.invoke_notification_dispatcher()                                 ← vault에서 URL과 시크릿을 읽는다
  → net.http_post → Edge Function dispatch-notifications
  → public.claim_notification_deliveries (최대 100건, lease 120초)
  → public.prepare_notification_delivery                                     ← 발송 직전 재확인
  → web-push / Resend(로컬은 Mailpit)
  → public.complete_notification_delivery (sent · retry · dead · gone)
```

조용히 죽는 지점이 많아 "cron이 돈다"만으로는 아무것도 보장되지 않는다. 아래 순서대로 확인한다.

## 접속 방법

로컬은 Studio(<http://127.0.0.1:54623>) 또는 다음을 쓴다.

```bash
docker exec supabase_db_KMLAONLINEv2 psql -U postgres -c "select 1"
```

원격은 Studio SQL Editor 또는 다음을 쓴다.

```bash
npx supabase db query --linked "select 1"
```

`--linked`는 `supabase/.temp/project-ref`가 가리키는 프로젝트를 따른다. `login role status 401`이
나오면 `npx supabase login`으로 토큰을 갱신한다.

## 1단계 — cron이 도는가

```sql
select jobid, jobname, schedule, active from cron.job where jobname like 'dispatch%';

select status, count(*), max(start_time) as last_run
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname like 'dispatch%')
group by status;
```

| 결과                              | 원인과 조치                                                  |
| --------------------------------- | ------------------------------------------------------------ |
| 잡이 없음                         | 확장을 껐다 켜면서 삭제됐다. "함정" 절을 따라 재등록한다     |
| 잡은 있으나 `job_run_details` 0건 | pg_cron 워커가 안 돈다. Extensions 토글 또는 프로젝트 재시작 |
| `succeeded`가 쌓임                | 2단계로 간다                                                 |

`succeeded`는 "`http_post`를 큐에 넣었다"까지만 뜻한다. 호출 성공이 아니다.

## 2단계 — 함수까지 도달하는가

```sql
select id, status_code, error_msg, left(content, 80) as content, created
from net._http_response
order by id desc
limit 5;
```

| 결과                        | 원인                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| 행이 늘지 않음              | `invoke_notification_dispatcher()`가 vault 값을 못 찾아 null을 반환한다      |
| `error_msg`에 연결·DNS 실패 | vault `project_url`이 틀렸다. 로컬 주소가 박힌 경우가 흔하다                 |
| 401                         | vault `notification_dispatch_secret` ≠ 함수의 `NOTIFICATION_DISPATCH_SECRET` |
| 405                         | POST가 아니다                                                                |
| 200 + totals JSON           | 정상. 3단계로 간다                                                           |

```sql
select name, decrypted_secret from vault.decrypted_secrets;
```

## 3단계 — 보낼 것이 있는가

```sql
select (select count(*) from private.web_push_subscriptions) as subs,
       (select count(*) from public.notifications) as notis;

select id, kind, category, importance, created_at
from public.notifications
order by created_at desc
limit 5;
```

`subs = 0`이면 보낼 대상이 없다. 알림 자체가 없으면 트리거를 의심한다. 반응은 알림은 만들되 푸시는
보내지 않으므로 반응으로 시험하지 않는다.

## 4단계 — outbox 상태

가장 중요한 쿼리다. 함수 로그의 `claimed: 0`은 "할 일이 없었다"와 "전부 억제됐다"를 구분하지
못한다. `claim_notification_deliveries`는 후보를 고르기 전에 배달 불가 항목을 먼저 `suppressed`로
바꾸는데 그 건수는 응답에 들어가지 않기 때문이다. 반드시 outbox를 직접 본다.

```sql
select o.status, o.channel, o.attempt_count,
       o.last_status_code, o.last_error_code,
       o.available_at, o.created_at,
       n.kind, n.importance,
       s.created_at as sub_created, s.foreground_until, now() as now_
from private.notification_delivery_outbox as o
left join public.notifications as n on n.id = o.notification_id
left join private.web_push_subscriptions as s on s.id = o.subscription_id
order by o.created_at desc
limit 20;
```

### 행이 아예 없다

알림은 생겼으나 outbox 진입에 실패했다. `enqueue_notification_push`가 insert 시점에 이미 거른다.

- 구독이 없다
- `sub_created > 알림 created_at`이다. 구독보다 먼저 생긴 알림은 설계상 제외한다
- `notification_preferences`에서 해당 카테고리 푸시가 꺼져 있다
- 푸시 제외 kind다. `post_reacted`, `comment_reacted`, `application_submitted`는 인앱 전용이다
- 그룹 콘텐츠인데 `group_memberships.content_push_enabled`가 false거나 `notification_level`이 맞지 않는다

### `suppressed` + `no_longer_deliverable`

`private.notification_delivery_allowed()`가 false를 반환했다. 대부분 포그라운드 억제다.

- 앱이 보이고 포커스가 있는 동안 30초마다 `refresh_my_web_push_foreground()`가 호출되어
  `foreground_until = now() + 40초`로 갱신된다
- 그 값이 살아 있고 `importance <> 'high'`면 억제한다. 앱을 떠난 뒤에도 10~40초 남는다
- **한 번 억제되면 종결이다.** `completed_at`이 찍히고 재평가하지 않으므로 뒤늦게 앱을 꺼도 오지 않는다
- 게시물 삭제, 그룹 탈퇴, 비공개 전환 등 대상 접근 권한을 잃은 경우도 같은 코드로 남는다

### `dead`

`last_status_code`로 가른다.

| 코드      | 원인                                               |
| --------- | -------------------------------------------------- |
| 403       | VAPID 키 불일치. 구독을 만든 키와 서명 키가 다르다 |
| 400 · 413 | payload 문제                                       |
| 422       | 구독 필드나 수신 이메일이 비었다                   |

`attempts_exhausted`는 재시도를 소진한 것이다.

### `gone`

404 또는 410이다. 구독이 폐기됐으므로 재구독해야 한다.

### `retry`

429·5xx 또는 `transport_error`다. backoff는 `15 * 2^attempt`초이고 상한은 1시간이다. `available_at`이
미래면 아직 대기 중이다. 5회를 넘기면 dead로 넘어간다.

### `sent`인데 알림이 뜨지 않는다

서버는 보냈다. 서비스 워커 등록·업데이트, OS 알림 권한, 집중 모드를 본다.
`NOTIFICATION_MANUAL_TESTING.md`의 "서비스 워커 업데이트"와 "앱 상태별 수신"을 따른다.

## 수동 실행

cron을 기다리지 않고 한 사이클을 돌린다.

```sql
select private.invoke_notification_dispatcher();
```

1~2초 뒤 `net._http_response`를 다시 본다.

함수를 직접 호출한다. 로컬 기준이다.

```bash
SECRET=$(docker exec supabase_db_KMLAONLINEv2 psql -U postgres -tAc \
  "select decrypted_secret from vault.decrypted_secrets where name='notification_dispatch_secret'" \
  | tr -d '\r\n')
curl -sS -X POST http://127.0.0.1:54621/functions/v1/dispatch-notifications \
  -H "x-dispatch-secret: $SECRET" -H "Content-Type: application/json" -d '{}'
```

시크릿을 빼면 401, GET이면 405, 정상이면
`{"claimed":N,"sent":N,"suppressed":N,"retry":N,"dead":N}`이 온다.

## 로컬 전 구간 시험

웹 푸시는 실제 브라우저 구독이 필요하지만 **이메일 채널은 브라우저 없이 전 구간을 검증**할 수 있다.
`RESEND_API_KEY`가 비어 있으면 함수가 nodemailer로 Mailpit(SMTP 54625)에 보낸다.

```sql
with n as (
  insert into public.notifications
    (recipient_profile_id, kind, importance, category, actor_identity, title)
  select id, 'account_approved', 'high', 'account', 'staff', '[점검] 파이프라인'
  from public.profiles order by id limit 1
  returning id
)
select private.enqueue_notification_email(n.id, 'check@example.com') from n;
```

30초 안에 cron이 집어간다. <http://127.0.0.1:54624>(Mailpit)에서 수신을 확인하고 정리한다.

```sql
delete from public.notifications where title like '[점검]%';
```

핸들러 단위 테스트는 다음과 같다.

```bash
cd supabase/functions/dispatch-notifications && deno test -A
```

## 웹 푸시 실제 시험 순서

억제 판정은 알림 생성 후 30초 안에 끝나고 되돌릴 수 없다. 순서를 지켜야 한다.

1. 수신 계정으로 알림 권한을 허용해 구독을 만든다
2. 수신 계정 탭에서 포커스를 뗀다
3. 45초 이상 기다린다

   ```sql
   select foreground_until, now(), foreground_until > now() as still_suppressing
   from private.web_push_subscriptions;
   ```

4. 그다음 다른 계정으로 댓글을 작성한다
5. 30초 안에 도착한다

기다리지 않으려면 알림 발생 직후 억제를 지운다.

```sql
update private.web_push_subscriptions set foreground_until = null;
```

## 함정

### `db reset --linked`는 원격 vault를 로컬 값으로 덮는다

`config.toml`의 `[db.seed] enabled = true` 때문에 reset 뒤 `supabase/seed.sql`이 원격에서도 실행된다.
그 안의 `vault.create_secret`이 `project_url`을 `http://host.docker.internal:54621`로,
`notification_dispatch_secret`을 `local-notification-dispatch-only`로 만든다. cron과 함수는 멀쩡한데
요청이 로컬 주소로 나가면서 아무 일도 일어나지 않는다. 구독과 데이터도 함께 사라진다.

원격에는 `npm run db:push:dev`만 쓴다. 이미 reset했다면 되돌린다.

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'project_url'),
  'https://<project-ref>.supabase.co'
);
select vault.update_secret(
  (select id from vault.secrets where name = 'notification_dispatch_secret'),
  '<실제 값>'
);
select vault.update_secret(
  (select id from vault.secrets where name = 'storage_cleanup_secret'),
  '<실제 값>'
);
```

실제 값은 `supabase/.env.dev.local`에 있다.

### Extensions에서 pg_cron을 껐다 켜면 잡이 사라진다

`cron.job`은 확장에 딸린 테이블이라 `drop extension`과 함께 지워지고 다시 켜도 복구되지 않는다.
마이그레이션의 `cron.schedule` 구문을 찾아 전부 재등록해야 한다. 알림 잡은 다음과 같다.

```sql
select cron.schedule(
  'dispatch-notifications-every-30-seconds',
  '30 seconds',
  'select private.invoke_notification_dispatcher()'
);
```

### VAPID 키가 환경마다 다르다

| 위치                                               | 용도            |
| -------------------------------------------------- | --------------- |
| `.env` `VITE_WEB_PUSH_VAPID_PUBLIC_KEY`            | 로컬 클라이언트 |
| `supabase/functions/.env` `VAPID_PUBLIC_KEY`       | 로컬 함수       |
| `.env.local.dev` `VITE_WEB_PUSH_VAPID_PUBLIC_KEY`  | dev 클라이언트  |
| `supabase/.env.dev.local` `VAPID_PUBLIC_KEY`       | dev 함수        |
| `.env.local.prod` `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` | prod 클라이언트 |

같은 환경의 클라이언트와 함수가 한 쌍이어야 한다. 어긋나면 403 dead로 떨어진다. 키 재생성은
`npm run web-push:keys`이며, 바꾸면 기존 구독이 모두 무효가 되어 재구독이 필요하다.

### Vault 이름과 함수 시크릿은 짝이다

`notification_dispatch_secret` ↔ `NOTIFICATION_DISPATCH_SECRET`이 어긋나면 401이 조용히 반복된다.
함수 쪽 값은 `npm run fn:secrets:dev`로 설정하며 DB reset의 영향을 받지 않는다.

## 코드 위치

| 대상                          | 위치                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| 전달 핸들러(분류·재시도 규칙) | `supabase/functions/dispatch-notifications/handler.ts`        |
| 전송 구현(web-push·메일)      | `supabase/functions/dispatch-notifications/index.ts`          |
| claim · prepare · complete    | `supabase/schemas/61-notifications.sql`                       |
| 포그라운드 하트비트           | `app/features/notifications/components/notification-sync.tsx` |
| 구독과 권한                   | `app/features/notifications/data/push.ts`                     |
