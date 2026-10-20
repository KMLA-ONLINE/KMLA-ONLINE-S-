SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.notification_delivery_allowed (
  p_delivery private.notification_delivery_outbox
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  -- 메시지 Push는 발송 직전 확인이 따로 있다(메시지 기술 설계, 알림 기술 설계 §11.3).
  -- 정지 기간에는 정지 이메일 말고는 보내지 않는다. 정지 전에 쌓인 Push도 여기서 걸러진다.
  select case
    -- 정지 메일은 그 정지가 아직 유효할 때만 보낸다. 바로 해제했거나 만료된 뒤 재시도로 늦게 나가지 않게 한다.
    when p_delivery.suspension_id is not null then p_delivery.suspension_event = 'lifted'
      or exists (
        select 1
        from private.profile_suspensions as suspension
        where suspension.id = p_delivery.suspension_id
          and suspension.ended_at is null
          and (suspension.expires_at is null or suspension.expires_at > now())
      )
    when private.profile_suspended(p_delivery.recipient_profile_id) then false
    when p_delivery.message_id is not null
    then private.message_delivery_allowed(p_delivery)
    else p_delivery.channel = 'email'
    or exists (
      select 1
      from public.notifications as notification
      join private.web_push_subscriptions as subscription
        on subscription.id = p_delivery.subscription_id
      where notification.id = p_delivery.notification_id
        and subscription.profile_id = p_delivery.recipient_profile_id
        and subscription.gone_at is null
        and private.notification_push_allowed(
          notification, subscription.created_at, subscription.expiration_time
        )
        and (
          notification.category = 'moderation'
          or notification.kind in (
            'group_deleted', 'group_join_rejected',
            'account_approved', 'account_rejected', 'account_blocked', 'account_unblocked'
          )
          or (
            notification.post_id is not null
            and exists (
              select 1
              from public.posts as post
              where post.id = notification.post_id
                and (
                  (post.kind = 'group' and exists (
                    select 1 from public.group_memberships as membership
                    where membership.group_id = post.group_id
                      and membership.profile_id = p_delivery.recipient_profile_id
                  ))
                  or (post.kind = 'profile' and post.visibility = 'public')
                )
            )
          )
          or (
            notification.post_id is null
            and notification.group_id is not null
            and exists (
              select 1 from public.group_memberships as membership
              join public.groups as group_record on group_record.id = membership.group_id
              where membership.group_id = notification.group_id
                and membership.profile_id = p_delivery.recipient_profile_id
            )
          )
          or (notification.post_id is null and notification.group_id is null)
        )
    )
  end;
$function$;

CREATE OR REPLACE FUNCTION private.notify_profile_changed()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor_profile_id bigint := private.current_profile_id();
  notification_id uuid;
  event_kind public.notification_kind;
  event_importance public.notification_importance;
  event_title text;
  recipient_email text;
begin
  if actor_profile_id is null then return new; end if;
  if old.status is distinct from new.status and new.status in ('accepted', 'blocked', 'draft') then
    -- `draft`로 돌아가는 길은 반려(승인 대기에서)와 차단 해제(차단에서) 두 가지다.
    event_kind := case
      when new.status = 'accepted' then 'account_approved'
      when new.status = 'blocked' then 'account_blocked'
      when old.status = 'pending' then 'account_rejected'
      else 'account_unblocked'
    end;
    event_importance := 'high';
    event_title := case event_kind
      when 'account_approved' then '가입이 승인되었습니다.'
      when 'account_blocked' then '가입이 차단되었습니다.'
      when 'account_rejected' then '가입 신청이 반려되었습니다.'
      else '차단이 해제되었습니다.'
    end;
    notification_id := private.emit_notification(
      'account-status:' || new.id::text || ':' || txid_current()::text,
      new.id, event_kind, event_importance, 'account', 'staff', actor_profile_id,
      '운영진', null, event_title, null, null, null, new.id
    );
    select user_record.email into recipient_email
    from auth.users as user_record where user_record.id = new.auth_user_id;
    perform private.enqueue_notification_email(notification_id, recipient_email);
  elsif old.role is distinct from new.role then
    perform private.emit_notification(
      'app-role:' || new.id::text || ':' || txid_current()::text,
      new.id,
      (case when new.role = 'admin' then 'app_admin_granted' else 'app_admin_revoked' end)::public.notification_kind,
      'high', 'account', 'staff', actor_profile_id, '운영진', null,
      case when new.role = 'admin'
        then '앱 관리자로 임명되었습니다.'
        else '앱 관리자 권한이 해제되었습니다.'
      end,
      null, null, null, new.id
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_applications (
  p_status public.profile_status,
  p_limit  integer               DEFAULT 50,
  p_offset integer               DEFAULT 0
)
  RETURNS TABLE (
    profile_id            bigint,
    name                  text,
    profile_type          public.profile_type,
    is_returning_student  boolean,
    submitted_at          timestamp with time zone,
    cohort                smallint,
    student_number        text,
    gender                public.profile_gender,
    birthday              date,
    rejection_count       bigint,
    last_rejection_reason text,
    total_count           bigint
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_app_admin();

  if p_status not in ('pending', 'blocked') then
    raise exception 'status must be pending or blocked' using errcode = '22023';
  end if;
  if p_limit not between 1 and 200 or p_offset < 0 then
    raise exception 'invalid pagination' using errcode = '22023';
  end if;

  return query
  select
    profile.id, profile.name, profile.type, profile.is_returning_student,
    profile.submitted_at, profile.cohort, profile.student_number,
    profile.gender, profile.birthday,
    coalesce(rejection.rejection_count, 0), rejection.last_reason,
    count(*) over ()
  from public.profiles as profile
  left join lateral (
    select
      count(*) as rejection_count,
      (array_agg(record.reason order by record.rejected_at desc, record.id desc))[1] as last_reason
    from private.application_rejections as record
    where record.profile_id = profile.id
    having count(*) > 0
  ) as rejection on true
  where profile.status = p_status
    and profile.deleted_at is null
  order by
    case when p_status = 'pending' then profile.submitted_at end asc,
    case when p_status = 'blocked' then profile.status_updated_at end desc,
    profile.id asc
  limit p_limit
  offset p_offset;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."admin_list_applications"(public.profile_status, integer, integer) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.admin_reject_application (
  p_profile_id bigint,
  p_reason     text
)
  RETURNS TABLE (
    profile_id        bigint,
    status            public.profile_status,
    status_updated_at timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.require_app_admin();
  trimmed_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(trimmed_reason) not between 5 and 300 then
    raise exception 'reason must be 5 to 300 characters' using errcode = '22023';
  end if;

  perform 1
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.status = 'pending'
    and profile.deleted_at is null
  for update;
  if not found then
    raise exception 'pending application not found' using errcode = '55000';
  end if;

  -- 상태 전환 알림 트리거가 이 기록을 읽어 반려 이메일 본문을 만들므로 먼저 남긴다.
  insert into private.application_rejections (profile_id, reason, rejected_by_profile_id)
  values (p_profile_id, trimmed_reason, caller_profile_id);

  return query
  update public.profiles as profile
  set
    status = 'draft',
    status_updated_at = now(),
    status_updated_by = caller_profile_id
  where profile.id = p_profile_id
  returning profile.id, profile.status, profile.status_updated_at;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."admin_reject_application"(bigint, text) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.admin_review_applications (
  p_profile_ids bigint[],
  p_status      public.profile_status
)
  RETURNS TABLE (
    profile_id        bigint,
    status            public.profile_status,
    status_updated_at timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.require_app_admin();
  requested_count integer := cardinality(p_profile_ids);
  locked_count integer;
begin
  if p_status not in ('accepted', 'blocked') then
    raise exception 'status must be accepted or blocked' using errcode = '22023';
  end if;
  if requested_count is null or requested_count not between 1 and 200 then
    raise exception 'between 1 and 200 applications are required' using errcode = '22023';
  end if;
  if requested_count <> (select count(distinct id) from unnest(p_profile_ids) as id)
    or array_position(p_profile_ids, null) is not null then
    raise exception 'application ids must be unique and nonnull' using errcode = '22023';
  end if;

  select count(*)
  into locked_count
  from (
    select profile.id
    from public.profiles as profile
    where profile.id = any(p_profile_ids)
      and profile.status = 'pending'
      and profile.deleted_at is null
    for update
  ) as locked_profiles;

  if locked_count <> requested_count then
    raise exception 'all applications must be pending' using errcode = '55000';
  end if;

  -- 반려 기록은 신청자가 고쳐 내고 관리자가 판단하는 데만 쓴다. 승인하면 쓸 일이 없으므로 지운다.
  -- 차단하면 판단 근거로 남긴다.
  if p_status = 'accepted' then
    delete from private.application_rejections as record
    where record.profile_id = any(p_profile_ids);
  end if;

  return query
  update public.profiles as profile
  set
    status = p_status,
    status_updated_at = now(),
    status_updated_by = caller_profile_id
  where profile.id = any(p_profile_ids)
  returning profile.id, profile.status, profile.status_updated_at;
end;
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
    coalesce(message_content.title, suspension_content.title, notification.title),
    case
      when claimed.message_id is not null then message_content.body
      when claimed.suspension_id is not null then suspension_content.body
      else case notification.kind
      when 'post_commented' then '내 게시물에 새 댓글이 등록되었습니다.'
      when 'comment_replied' then '내 댓글에 새 답글이 등록되었습니다.'
      when 'group_posted' then '그룹에 새 게시물이 등록되었습니다.'
      when 'account_approved' then '가입이 승인되었습니다.'
      -- 반려 사유는 본인 메일함에만 보낸다. Push는 잠금 화면에 보일 수 있다.
      when 'account_rejected' then case
        when claimed.channel = 'email' and rejection_content.reason is not null
          then '사유: ' || rejection_content.reason || chr(10) || chr(10)
        else ''
      end || '학교 프로필 설정에서 정보를 고쳐 다시 제출해 주세요.'
      when 'account_blocked' then '가입이 차단되었습니다.'
      when 'account_unblocked' then '학교 프로필 설정에서 정보를 확인하고 다시 제출해 주세요.'
      when 'anonymous_activity_restricted' then '그룹 익명 활동이 제한되었습니다.'
      when 'post_mentioned' then '게시물에서 회원님을 멘션했습니다.'
      when 'comment_mentioned' then '댓글에서 회원님을 멘션했습니다.'
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

CREATE OR REPLACE FUNCTION public.get_my_application_rejection()
  RETURNS TABLE (
    reason      text,
    rejected_at timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select rejection.reason, rejection.rejected_at
  from public.profiles as profile
  join private.application_rejections as rejection on rejection.profile_id = profile.id
  where profile.auth_user_id = (select auth.uid())
    and profile.status = 'draft'
    and profile.deleted_at is null
  order by rejection.rejected_at desc, rejection.id desc
  limit 1;
$function$;

REVOKE ALL ON FUNCTION "public"."get_my_application_rejection"() FROM PUBLIC, "anon", "service_role";

ALTER TABLE "private"."application_rejections"
  ADD CONSTRAINT "application_rejections_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "private"."application_rejections"
  ADD CONSTRAINT "application_rejections_rejected_by_fkey" FOREIGN KEY (rejected_by_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX application_rejections_profile_idx ON private.application_rejections USING btree (profile_id, rejected_at DESC);

CREATE INDEX application_rejections_rejected_by_idx ON private.application_rejections USING btree (rejected_by_profile_id)
  WHERE (rejected_by_profile_id IS NOT NULL);

CREATE POLICY "application_rejections_deny_client_access" ON "private"."application_rejections"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

GRANT EXECUTE ON FUNCTION "public"."admin_list_applications"(public.profile_status, integer, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_list_applications"(public.profile_status, integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_list_applications"(public.profile_status, integer, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_reject_application"(bigint, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_reject_application"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_reject_application"(bigint, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_my_application_rejection"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_my_application_rejection"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_my_application_rejection"() TO "postgres";

