SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.notification_push_content (
  p_notification_id uuid
)
  RETURNS TABLE (
    title text,
    body  text
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  with source as (
    select notification.*,
      target_group.name as group_name,
      case
        when char_length(btrim(target_post.title)) > 40
          then '“' || left(btrim(target_post.title), 39) || '…”'
        else '“' || btrim(target_post.title) || '”'
      end as post_title,
      coalesce(notification.actor_display_name, '탈퇴한 사용자')
        || case
          when notification.actor_count > 1
            then ' 외 ' || (notification.actor_count - 1)::text || '명'
          else ''
        end as actor,
      membership.role as member_role
    from public.notifications as notification
    left join public.groups as target_group on target_group.id = notification.group_id
    left join public.posts as target_post on target_post.id = notification.post_id
    left join public.group_memberships as membership
      on membership.group_id = notification.group_id
      and membership.profile_id = notification.recipient_profile_id
    where notification.id = p_notification_id
  ), content as (
    select
      case
        when source.kind in (
          'post_commented', 'comment_replied', 'post_mentioned', 'comment_mentioned'
        ) then source.actor || coalesce(' · ' || source.group_name, '')
        when source.kind in ('timeline_posted', 'timeline_post_deleted') then source.actor
        when source.kind in ('post_moderated', 'comment_moderated', 'anonymous_activity_restricted')
          then '운영 조치'
        when source.kind = 'gongang_preempted' then '공강 예약'
        when source.group_name is not null then source.group_name
        else 'KMLA Online'
      end as title,
      case source.kind
        when 'post_commented' then
          coalesce(source.post_title || '에 ', '내 게시물에 ') || '댓글을 남겼습니다.'
        when 'comment_replied' then
          coalesce(source.post_title || '에서 ', '') || '내 댓글에 답글을 남겼습니다.'
        when 'post_mentioned' then
          coalesce(source.post_title || '에서 ', '게시물에서 ') || '회원님을 멘션했습니다.'
        when 'comment_mentioned' then
          coalesce(source.post_title || '의 댓글에서 ', '댓글에서 ') || '회원님을 멘션했습니다.'
        when 'timeline_posted' then '내 타임라인에 게시물을 남겼습니다.'
        when 'timeline_post_deleted' then '타임라인에 남긴 내 게시물을 삭제했습니다.'
        -- 새 그룹 게시물 알림의 `title`은 게시물 제목이다. 메시지 그룹 카드처럼 작성자를 앞에 둔다.
        when 'group_posted' then source.actor || ': ' || source.title
        when 'group_join_requested' then source.actor || '님이 가입을 요청했습니다.'
        when 'group_join_approved' then '가입 요청이 승인되었습니다.'
        when 'group_join_rejected' then '가입 요청이 거절되었습니다.'
        -- 알림에 바뀐 역할을 남기지 않으므로 지금 역할을 쓴다. 그사이 다시 바뀌었으면 최신 역할이다.
        when 'group_role_changed' then case source.member_role
          when 'owner' then '내 역할이 소유자로 변경되었습니다.'
          when 'admin' then '내 역할이 관리자로 변경되었습니다.'
          when 'manager' then '내 역할이 매니저로 변경되었습니다.'
          when 'member' then '내 역할이 멤버로 변경되었습니다.'
          else '내 그룹 역할이 변경되었습니다.'
        end
        when 'official_group_joined' then '공식 그룹에 자동으로 가입되었습니다.'
        when 'anonymous_activity_restricted' then
          coalesce(source.group_name || ' 그룹에서 ', '그룹에서 ') || '익명 활동이 제한되었습니다.'
        when 'account_approved' then '가입이 승인되었습니다. 이제 KMLA Online을 이용할 수 있습니다.'
        -- 반려 사유는 본인 메일함에만 보낸다(기능 명세 §14.6).
        when 'account_rejected' then
          '가입 신청이 반려되었습니다. 학교 프로필 설정에서 정보를 고쳐 다시 제출해 주세요.'
        when 'account_unblocked' then
          '차단이 해제되었습니다. 학교 프로필 설정에서 정보를 확인하고 다시 제출해 주세요.'
        else source.title
      end as body
    from source
  )
  -- 서비스 워커 검증 한도(제목 160자, 본문 240자)와 같다. 둘 다 code point로 센다.
  select left(content.title, 160), left(content.body, 240)
  from content;
$function$;

CREATE OR REPLACE FUNCTION public.claim_notification_deliveries (
  p_limit         integer DEFAULT 50,
  p_lease_seconds integer DEFAULT 120
)
  RETURNS TABLE (
    delivery_id     uuid,
    lease_id        uuid,
    channel         private.notification_delivery_channel,
    endpoint        text,
    p256dh          text,
    auth            text,
    recipient_email text,
    notification_id uuid,
    message_id      uuid,
    conversation_id uuid,
    importance      public.notification_importance,
    category        public.notification_category,
    grouping_key    uuid,
    title           text,
    body            text,
    tag             text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if p_limit not between 1 and 200 or p_lease_seconds not between 30 and 600 then
    raise exception 'invalid notification lease parameters' using errcode = '22023';
  end if;
  update private.notification_delivery_outbox as delivery
  set status = 'suppressed', completed_at = now(),
    lease_id = null, lease_expires_at = null,
    last_error_code = 'no_longer_deliverable'
  where delivery.channel = 'web_push'
    and (
      delivery.status = 'pending'
      or (delivery.status = 'leased' and delivery.lease_expires_at <= now())
    )
    and delivery.available_at <= now()
    and not private.notification_delivery_allowed(delivery);
  update private.notification_delivery_outbox as delivery
  set status = 'dead', completed_at = now(),
    lease_id = null, lease_expires_at = null,
    last_error_code = 'attempts_exhausted'
  where (
      delivery.status = 'pending'
      or (delivery.status = 'leased' and delivery.lease_expires_at <= now())
    )
    and delivery.available_at <= now()
    and delivery.attempt_count >= 10;

  return query
  with candidates as (
    select delivery.id
    from private.notification_delivery_outbox as delivery
    where (
        delivery.status = 'pending'
        or (delivery.status = 'leased' and delivery.lease_expires_at <= now())
      )
      and delivery.available_at <= now()
      and delivery.attempt_count < 10
    order by delivery.available_at, delivery.created_at, delivery.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update private.notification_delivery_outbox as delivery
    set status = 'leased', lease_id = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = delivery.attempt_count + 1
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  ), keys as (
    -- 메시지 본문은 이 배치에 메시지 Push가 있을 때만 키를 읽어 복호화한다.
    select case
      when exists (select 1 from claimed where claimed.message_id is not null)
        then private.message_keys()
    end as value
  )
  select claimed.id, claimed.lease_id, claimed.channel,
    subscription.endpoint, subscription.p256dh, subscription.auth,
    claimed.recipient_email, notification.id,
    claimed.message_id, message_content.conversation_id,
    notification.importance, notification.category,
    subscription.id,
    coalesce(
      message_content.title, suspension_content.title, push_content.title, notification.title
    ),
    case
      when claimed.message_id is not null then message_content.body
      when claimed.suspension_id is not null then suspension_content.body
      when claimed.channel = 'web_push' then push_content.body
      -- 메일은 계정 상태 알림에만 쓴다. 제목은 알림함 문장 그대로다.
      else case notification.kind
      when 'account_approved' then '가입이 승인되었습니다.'
      when 'account_rejected' then case
        when rejection_content.reason is not null
          then '사유: ' || rejection_content.reason || chr(10) || chr(10)
        else ''
      end || '학교 프로필 설정에서 정보를 고쳐 다시 제출해 주세요.'
      when 'account_blocked' then '가입이 차단되었습니다.'
      when 'account_unblocked' then '학교 프로필 설정에서 정보를 확인하고 다시 제출해 주세요.'
      else '새 알림이 있습니다.'
      end
    end,
    case
      when claimed.message_id is not null
        then 'message:' || message_content.conversation_id::text
      when claimed.suspension_id is not null
        then 'suspension:' || claimed.suspension_id::text || ':' || claimed.suspension_event
      when notification.importance = 'high'
        then 'notification:' || notification.id::text
      else 'notification-category:' || notification.category::text || ':' || subscription.id::text
    end
  from claimed
  left join private.web_push_subscriptions as subscription
    on subscription.id = claimed.subscription_id
  left join public.notifications as notification
    on notification.id = claimed.notification_id
  cross join keys
  left join lateral private.message_push_content(
    claimed.message_id, claimed.recipient_profile_id, keys.value
  ) as message_content on true
  left join lateral private.notification_push_content(notification.id) as push_content
    on claimed.channel = 'web_push'
  left join lateral (
    select
      case claimed.suspension_event
        when 'suspended' then '이용이 정지되었습니다.'
        else '이용 정지가 해제되었습니다.'
      end as title,
      case claimed.suspension_event
        when 'suspended' then
          '사유: ' || suspension.reason || chr(10) || '해제 예정: ' || coalesce(
            to_char(suspension.expires_at at time zone 'Asia/Seoul', 'YYYY"년" FMMM"월" FMDD"일" HH24:MI') || ' (한국 시간)',
            '무기한'
          )
        else '다시 KMLA Online을 이용할 수 있습니다.'
      end as body
    from private.profile_suspensions as suspension
    where suspension.id = claimed.suspension_id
  ) as suspension_content on true
  -- 반려 기록은 알림과 같은 트랜잭션에서 남으므로 알림 시각 이전의 가장 최근 기록이 그 반려다.
  -- 발송 전에 승인돼 기록이 지워졌으면 사유 없이 보낸다.
  left join lateral (
    select record.reason
    from private.application_rejections as record
    where notification.kind = 'account_rejected'
      and record.profile_id = notification.recipient_profile_id
      and record.rejected_at <= notification.created_at
    order by record.rejected_at desc, record.id desc
    limit 1
  ) as rejection_content on true;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."notification_push_content"(uuid) FROM PUBLIC;
