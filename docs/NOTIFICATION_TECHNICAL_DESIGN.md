# 알림 및 Web Push 기술 설계

이 문서는 알림 기능 명세를 구현하기 위한 데이터, 전달, 클라이언트 동기화와 보안 경계를 정의한다.
제품 동작의 정본은 기능 명세이며, 수동 검증은 `NOTIFICATION_MANUAL_TESTING.md`를 따른다.

## 1. 범위

첫 구현은 원본 기능이 이미 존재하는 다음 이벤트를 지원한다.

- 댓글, 답글, 게시물·댓글 반응
- 타임라인 게시물 작성과 타임라인 당사자의 삭제
- 새 그룹 게시물
- 가입 요청, 승인, 거절, 역할, 소유권, 공식 그룹 자동 가입, 그룹 정책, 그룹 삭제
- 운영자의 게시물·댓글 삭제
- 가입 승인·차단·해제, 앱 관리자와 공강 관리자 권한 변경
- 관리자 선예약으로 종료된 장기 공강 예약
- 가입 승인·차단·해제 이메일

멘션, 익명 활동 제한, 메시지, 사용자 지정 그룹 초대, 노래방 참여자, 예약 리마인더,
비밀번호 변경·초기화와 계정 탈퇴는 원본 기능과 세부 정책이 구현될 때 같은 기반에 추가한다.

댓글 스레드를 삭제할 때에는 직접 선택한 댓글 작성자에게만 알린다. 그룹을 삭제한 소유자 본인에게는
알리지 않는다.

## 2. 원칙

- `public.notifications`가 인앱 알림의 정본이며 Web Push와 이메일은 전달 채널이다.
- 원본 mutation과 인앱 알림·outbox 생성은 같은 Postgres transaction에서 확정한다.
- 외부 Push Service와 이메일 제공자 호출은 transaction 밖의 Edge Function에서 수행한다.
- Push 또는 이메일 실패가 인앱 알림이나 원본 사용자 작업을 되돌리지 않는다.
- 알림 수신자, 중복 방지, 집계, 신원 보호와 전달 가능 여부는 서버가 결정한다.
- 브라우저는 임의 수신자, 중요도, 목적지 URL 또는 발송 채널을 지정하지 않는다.
- 메시지 unread와 메시지 Push는 일반 알림함과 분리한다.

## 3. 데이터 모델

### 3.1 인앱 알림

`public.notifications`에는 수신자가 보아도 안전한 표현 정보만 저장한다.

- 수신자와 알림 종류·중요도
- 최초 생성 시각과 마지막 활동 시각, 읽은 시각
- 표시 신원 종류와 공개 가능한 프로필 참조 또는 고정 표시명
- 집계된 행위자 수
- 그룹·게시물·댓글 등 구조화된 목적지 참조
- 삭제된 대상에 사용할 최소한의 안전한 제목

익명 활동의 실제 사용자와 운영 조치를 수행한 운영자는 public 행에 저장하지 않는다. 임의 JSON payload와
임의 URL도 저장하지 않는다.

반응 집계 알림에 새로운 사용자의 반응이 추가되면 `last_activity_at`을 갱신하고 읽지 않음으로 되돌려
목록 상단에 배치한다. 같은 사용자의 반응 변경·취소·재등록은 새 활동으로 처리하지 않는다. 최근 24시간
badge, 목록 구분과 30일 보존은 `last_activity_at`을 기준으로 한다.

### 3.2 계정 공통 설정

`public.notification_preferences`는 다음 유형별 Web Push opt-out을 계정 공통으로 저장한다.

- 댓글·답글 등 콘텐츠
- 타임라인
- 그룹 가입·역할 등 그룹 상태
- 계정·권한
- 학교 기능

보통·높음 중요도 유형은 기본 활성화한다. 운영 조치는 유형별 opt-out을 제공하지 않는다.

### 3.3 그룹 설정

`public.group_memberships`에 앱 알림함 범위를 정하는 `notification_level`, 직접 관련 활동의 Web Push를
정하는 `content_push_enabled`, 새 게시물 Web Push를 정하는 `new_post_push_enabled`를 둔다. 공식 그룹은
`all`, 비공식 그룹은 `direct`가 기본값이며 직접 관련 활동 Push는 기본 활성화한다. 새 게시물 Push는
낮음 중요도이므로 별도로 켠 경우에만 보낸다.

Web Push는 인앱 알림에서 파생되는 보조 채널이므로 Push만 단독으로 받는 조합은 만들지 않는다.
`notification_level = none`이면 두 그룹 Push 설정을 끄고, `direct`이면 새 게시물 Push를 끈다. 이 규칙은
공개 RPC와 데이터베이스 제약조건에서 함께 강제한다.

### 3.4 기기별 Push 구독

`private.web_push_subscriptions` 한 행을 하나의 Push 가능 브라우저 설치본으로 취급하며 별도 `devices`
테이블을 만들지 않는다. endpoint와 `p256dh`, `auth` 키는 capability secret이므로 private schema에 두고
등록 이후 클라이언트에 다시 반환하지 않는다.

Web Push 전체 켜기·끄기는 기기별이다. 사용자가 끄거나 로그아웃하면 현재 endpoint의 서버 연결을 먼저
제거하고 브라우저 구독을 해제한다. 유형별·그룹별 설정은 계정 공통이다. endpoint는 전역 unique이며
현재 인증 사용자만 등록·해제할 수 있다.

### 3.5 중복과 집계

`private.notification_event_keys`가 원본 활동의 안정적인 event key를 보관한다. 반응은 행위자별 event
key와 대상별 aggregate key를 분리해 변경·취소·재등록은 막고 여러 행위자는 한 알림으로 집계한다.
소유권 이전, 답글과 댓글, 멘션과 직접 활동도 하나의 의미 있는 알림으로 정규화한다.

### 3.6 전달 outbox

`private.notification_delivery_outbox`와 delivery attempt는 채널, 발송 가능 시각, attempt, lease,
성공·suppressed·dead-letter 상태와 안정적인 delivery ID를 저장한다. worker는 `FOR UPDATE SKIP LOCKED`
lease로 작업을 claim한다. 만료 lease를 포함한 claim 횟수가 hard limit에 도달하면 해당 작업만
dead-letter 처리하여 나머지 작업의 claim을 막지 않는다.

Push 발송 직전에 기기 상태, 최신 유형·그룹 설정과 현재 대상 접근 권한을 다시 확인한다. subscription이
알림보다 나중에 활성화된 경우 과거 알림을 새 기기로 보내지 않는다.
가입 승인·거절 같은 직접 결과 알림은 현재 그룹 멤버십이 없어도 수신자에게 전달한다.

## 4. 공개 API

클라이언트는 다음의 좁은 authenticated RPC만 사용한다.

- `list_my_notifications`
- `mark_my_notification_read`
- `mark_all_my_notifications_read`
- `get_my_recent_unread_notification_count`
- `get_my_notification_preferences`
- `update_my_notification_preferences`
- `set_my_group_notification_preferences`
- `register_my_web_push_subscription`
- `unregister_my_web_push_subscription`
- `get_my_web_push_status`
- `resolve_my_notification_destination`

목록은 `(last_activity_at, id)` 커서를 사용한다. 목적지 resolver는 알림 소유권과 현재 접근 권한을
확인하고 읽음 처리한 뒤 허용된 앱 내부 목적지만 반환한다.

`list_my_notifications`는 저장된 `group_id` 옆에 그 그룹의 이름도 함께 반환한다. 수신자 본인의 알림만
돌려주는 definer 함수 안에서 이름을 붙이므로 목록 화면이 그룹마다 별도 조회를 만들지 않는다. 그룹
삭제는 soft delete이므로 삭제된 그룹의 알림도 이름을 유지하고, 그룹과 무관한 알림만 이름이 비어서
나온다.

## 5. 보안

- `public.notifications`는 수신자 본인에게만 SELECT를 허용하고 쓰기는 RPC로 제한한다.
- public table의 불필요한 `MAINTAIN`, `REFERENCES`, `TRIGGER`, `TRUNCATE` 권한을 회수한다.
- subscription, event key, outbox와 실제 익명 신원은 client role에서 모두 회수한다.
- definer 함수는 `search_path = ''`과 내부 호출자 검증을 사용한다.
- Push payload에는 opaque notification/delivery ID와 안전한 제목·본문·tag만 넣는다.
- Push payload에 사용자 내부 ID, 실제 익명 신원, 운영자 신원, 원문, 파일명, endpoint와 외부 URL을
  넣지 않는다.

## 6. 전달 worker

Supabase Cron이 30초마다 `pg_net`으로 `dispatch-notifications` Edge Function을 호출한다. worker는 전용
shared secret을 검증하고 service role로 bounded batch를 처리한다.

worker는 delivery를 lease한 뒤 각 항목을 외부 서비스로 보내기 직전에
`prepare_notification_delivery`로 lease 소유권, 최신 설정과 대상 접근 권한을 다시 확인한다. 다른
dispatcher는 만료되지 않은 lease를 suppress하거나 가져가지 않는다. 최종 확인에서 더 이상 전달할 수
없는 항목은 외부 호출 없이 suppress한다.

- Web Push 2xx는 성공 처리한다.
- 404와 410은 subscription을 폐기한다.
- 429와 5xx는 제한된 exponential backoff로 재시도한다.
- 영구 payload·key 오류는 dead-letter 처리한다.
- 로그에는 안정적인 내부 작업 ID와 집계만 남기고 endpoint·키·이메일 주소를 남기지 않는다.

Production 앱 이벤트 이메일은 Resend를 사용한다. 로컬은 Supabase 개발 환경의 Mailpit을 사용한다.
비밀 값은 Edge Function secret에만 두며 브라우저에는 VAPID 공개 키만 제공한다.

## 7. 서비스 워커와 클릭

기존 Workbox `generateSW`의 app shell·업데이트 정책을 유지하고 `importScripts`로 Push handler를 추가한다.
handler는 `push`와 `notificationclick`을 처리한다. 동일 delivery ID와 notification tag를 사용해
at-least-once 전달의 중복 표시를 억제한다.

클릭 시 payload URL을 열지 않고 `/noti/open/:notificationId`만 구성한다. 기존 앱 창이 있으면 focus와
navigate를 사용하고 없으면 새 창을 연다. resolver route는 인증, 현재 계정, 대상 접근 권한과 읽음
처리를 다시 확인한다. 로그인하지 않았다면 안전하게 검증한 상대 `next` 경로를 로그인 후 복원한다.

resolver route는 history에 남지 않는다. 남으면 뒤로가기가 resolver의 loader를 다시 돌려 목적지로
되돌려 보내므로 사용자가 알림으로 들어온 화면에서 빠져나갈 수 없다. 인증된 목적지는 resolver
route가 history에 확정된 다음 그 entry를 replace한다. SPA navigation의 loader에서 즉시 replace하면
아직 현재 entry인 출발 화면을 덮어쓰므로, 알림함에서 시작했다는 navigation state도 이 단계까지
유지한다. 로그인과 알림함으로 빠지는 갈래는 loader가 즉시 replace하며 로그인 화면도 같은 이유로
남기지 않는다.

앱이 이미 떠 있던 창이면 그것으로 끝이며 뒤로가기는 원래 보던 화면으로 돌아간다. 앱이 종료된
상태에서 열린 창에는 돌아갈 화면 자체가 없으므로, 목적지가 앱 안에서 놓여 있던 자리를 밑에 깔고
그 위에 목적지를 얹는다. 그룹 게시물 알림이라면 `/` → `/groups` → `/groups/:slug` 위에 게시물이
놓이고, 뒤로가기는 "게시물이 닫히고 그룹 화면"이 된다. 깔아 둔 화면은 실제로 그리지 않으므로
사용자가 실제로 뒤로 갔을 때 비로소 그 화면의 loader가 돈다.

깔아 둘 화면은 `app/shared/lib/back-stack.ts`가 라우트별 직속 부모로 **선언**한다. 경로에서
세그먼트를 떼어 부모를 유추하지 않는다 — `/profile/:pubId`에서 한 칸 떼면 나오는 `/profile`은 그
사람 화면의 상위가 아니라 "내 프로필"이다. 이 표는 뒤로가기 내역이 없을 때 채울 값만 정의한다.
앱 안에서 이동해 들어온 경우의 뒤로가기는 이 표와 무관하게 "내가 온 곳"으로 남으며, 기존 내역을
이 값으로 덮어쓰지 않는다.

## 8. 클라이언트 동기화

알림 첫 페이지는 route `clientLoader`, 읽음 변경은 `clientAction`과 fetcher를 사용한다. 이전 페이지는
커서 기반으로 추가 로딩한다. `public.notifications`의 Realtime INSERT·UPDATE·DELETE는 알림 캐시와 셸
badge를 갱신하며 창 focus 복귀 시 revalidation을 fallback으로 사용한다.

Push 권한 설명은 승인 사용자의 gate 아래에서 표시한다. 사용자 동작 안에서만 브라우저 권한을 요청하고,
기기·계정별 prompt 상태는 versioned localStorage key에 저장한다. 서비스 워커 업데이트, iOS 설치 안내,
Push 권한과 일반 설치 안내가 겹치지 않도록 전역 PWA prompt 우선순위를 둔다.

## 9. 지원 환경

다음 환경을 정식 수동 인수 테스트 범위로 사용한다.

- 데스크톱 Chrome과 Safari
- Android Chrome
- iPhone·iPad 설치형 PWA

iOS/iPadOS의 일반 Safari 탭에는 설치 안내를 제공하고 설치형 PWA에서 Push 권한을 요청한다. 실제 HTTPS
스테이징, 여러 실제 기기, 잠금 화면, 종료·오프라인·재부팅과 서비스 워커 교체는 자동 테스트를
대체하지 않고 수동 체크리스트로 검증한다.

## 10. 검증

- pgTAP: grants, RLS, 수신자, 중복·집계, 원자성, fanout, lease·retry·retention
- Vitest: route, 설정·권한 상태, formatter, 안전한 목적지, service worker 계약
- Edge Function 테스트: 최신 설정, payload allowlist, Push 응답과 Resend/Mailpit adapter
- Playwright: production worker 생성, permission 상태, 로그인 복귀와 click resolver
- 수동: `NOTIFICATION_MANUAL_TESTING.md` 전체 및 출시 전 필수 시나리오
