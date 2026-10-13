SET local check_function_bodies = off;

DROP FUNCTION "public"."claim_notification_deliveries"(integer, integer);

DROP FUNCTION "public"."get_my_notification_preferences"();

CREATE TABLE "private"."notification_dispatcher_wakes" (
  "id"       smallint                 NOT NULL DEFAULT 1,
  "woken_at" timestamp with time zone NOT NULL,
  CONSTRAINT "notification_dispatcher_wakes_pkey" PRIMARY KEY (id),
  CONSTRAINT "notification_dispatcher_wakes_singleton" CHECK ((id = 1))
);

ALTER TABLE "private"."notification_dispatcher_wakes"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "private"."notification_dispatcher_wakes" FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "private"."notification_delivery_outbox"
  ADD COLUMN "message_id" uuid;

ALTER TABLE "public"."notification_preferences"
  ADD COLUMN "message_preview_hidden" boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION private.cleanup_expired_notifications()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  removed bigint;
begin
  delete from public.notifications
  where last_activity_at < now() - interval '30 days';
  get diagnostics removed = row_count;
  delete from private.notification_event_keys
  where notification_id is null and created_at < now() - interval '30 days';
  delete from private.web_push_subscriptions
  where gone_at < now() - interval '30 days';
  -- 메시지 Push 행은 알림처럼 cascade로 지워지지 않는다. 메시지는 삭제해도 행이 남기 때문이다.
  delete from private.notification_delivery_outbox
  where message_id is not null
    and completed_at < now() - interval '30 days';
  return removed;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_message_push (
  p_message private.messages
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  insert into private.notification_delivery_outbox (
    message_id, recipient_profile_id, subscription_id, channel, available_at
  )
  select
    p_message.id,
    member.profile_id,
    subscription.id,
    'web_push',
    p_message.sent_at + interval '2 seconds'
  from public.conversation_members as member
  join private.web_push_subscriptions as subscription
    on subscription.profile_id = member.profile_id
    and subscription.gone_at is null
    and (subscription.expiration_time is null or subscription.expiration_time > now())
  where member.conversation_id = p_message.conversation_id
    and member.left_at is null
    and member.profile_id is distinct from p_message.sender_id
    and (member.muted_until is null or member.muted_until <= now())
  on conflict do nothing;

  if found then
    perform private.wake_notification_dispatcher();
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.message_delivery_allowed (
  p_delivery private.notification_delivery_outbox
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from private.messages as message
    join private.web_push_subscriptions as subscription
      on subscription.id = p_delivery.subscription_id
      and subscription.profile_id = p_delivery.recipient_profile_id
      and subscription.gone_at is null
      and (subscription.expiration_time is null or subscription.expiration_time > now())
    join public.conversation_members as member
      on member.conversation_id = message.conversation_id
      and member.profile_id = p_delivery.recipient_profile_id
      and member.left_at is null
      and message.sent_at >= member.joined_at
    where message.id = p_delivery.message_id
      and message.deleted_at is null
      and (member.muted_until is null or member.muted_until <= now())
      and (member.last_read_sent_at, member.last_read_message_id) < (message.sent_at, message.id)
      and not exists (
        select 1
        from private.notification_delivery_outbox as newer
        join private.messages as newer_message on newer_message.id = newer.message_id
        where newer.subscription_id = p_delivery.subscription_id
          and newer.id <> p_delivery.id
          and newer.status in ('pending', 'leased')
          and newer_message.conversation_id = message.conversation_id
          and (newer_message.sent_at, newer_message.id) > (message.sent_at, message.id)
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.message_push_content (
  p_message_id           uuid,
  p_recipient_profile_id bigint,
  p_keys                 jsonb
)
  RETURNS TABLE (
    conversation_id uuid,
    title           text,
    body            text
  )
  LANGUAGE sql
  STABLE
  STRICT
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select
    message.conversation_id,
    case conversation.type
      when 'group' then conversation.name
      else coalesce(sender.name, '알 수 없는 사용자')
    end,
    left(
      case
        when conversation.type = 'group'
          then coalesce(sender.name, '알 수 없는 사용자') || ': '
        else ''
      end
      || case
        when coalesce(preference.message_preview_hidden, false) then '새 메시지가 있습니다.'
        else private.decrypt_message_text(message.body_ciphertext, message.key_version, p_keys)
      end,
      240
    )
  from private.messages as message
  join public.conversations as conversation on conversation.id = message.conversation_id
  left join public.profiles as sender on sender.id = message.sender_id
  left join public.notification_preferences as preference
    on preference.profile_id = p_recipient_profile_id
  where message.id = p_message_id
    and message.deleted_at is null;
$function$;

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
  select case when p_delivery.message_id is not null
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
            'account_approved', 'account_blocked', 'account_unblocked'
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

CREATE OR REPLACE FUNCTION private.wake_notification_dispatcher()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  -- 이 함수는 전송 트랜잭션 안에서 돈다. 모든 전송이 한 행의 잠금에 줄을 서지 않도록, 먼저 잠그지
  -- 않고 읽어 최근에 깨웠으면 넘어가고, 다른 트랜잭션이 지금 깨우는 중이면 기다리지 않고 넘어간다.
  if exists (
    select 1
    from private.notification_dispatcher_wakes as wake
    where wake.woken_at >= now() - interval '1 second'
  ) then
    return;
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('private.wake_notification_dispatcher')
  ) then
    return;
  end if;

  insert into private.notification_dispatcher_wakes as wake (id, woken_at)
  values (1, now())
  on conflict (id) do update set woken_at = excluded.woken_at
  where wake.woken_at < now() - interval '1 second';
  if found then
    perform private.invoke_notification_dispatcher();
  end if;
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
    coalesce(message_content.title, notification.title),
    case
      when claimed.message_id is not null then message_content.body
      else case notification.kind
      when 'post_commented' then '내 게시물에 새 댓글이 등록되었습니다.'
      when 'comment_replied' then '내 댓글에 새 답글이 등록되었습니다.'
      when 'group_posted' then '그룹에 새 게시물이 등록되었습니다.'
      when 'account_approved' then '가입이 승인되었습니다.'
      when 'account_blocked' then '가입이 차단되었습니다.'
      when 'account_unblocked' then '차단이 해제되었습니다.'
      when 'anonymous_activity_restricted' then '그룹 익명 활동이 제한되었습니다.'
      when 'post_mentioned' then '게시물에서 회원님을 멘션했습니다.'
      when 'comment_mentioned' then '댓글에서 회원님을 멘션했습니다.'
      else '새 알림이 있습니다.'
      end
    end,
    case
      when claimed.message_id is not null
        then 'message:' || message_content.conversation_id::text
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
  ) as message_content on true;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."claim_notification_deliveries"(integer, integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.get_my_notification_preferences()
  RETURNS TABLE (
    content_push_enabled   boolean,
    timeline_push_enabled  boolean,
    group_push_enabled     boolean,
    account_push_enabled   boolean,
    school_push_enabled    boolean,
    message_preview_hidden boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  insert into public.notification_preferences (profile_id)
  values (caller_profile_id)
  on conflict do nothing;
  return query
  select preference.content_push_enabled, preference.timeline_push_enabled,
    preference.group_push_enabled, preference.account_push_enabled,
    preference.school_push_enabled, preference.message_preview_hidden
  from public.notification_preferences as preference
  where preference.profile_id = caller_profile_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."get_my_notification_preferences"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.next_message_delivery_at (
  p_within_seconds integer DEFAULT 5
)
  RETURNS timestamp WITH time zone
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select min(delivery.available_at)
  from private.notification_delivery_outbox as delivery
  where delivery.message_id is not null
    and delivery.status = 'pending'
    and delivery.available_at <= now() + make_interval(secs => least(greatest(p_within_seconds, 0), 10));
$function$;

REVOKE ALL ON FUNCTION "public"."next_message_delivery_at"(integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.send_message (
  p_conversation_id uuid,
  p_message_id      uuid,
  p_body            text,
  p_reply_to_id     uuid DEFAULT NULL::uuid
)
  RETURNS TABLE (
    id      uuid,
    sent_at timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  normalized_body text;
  encrypted record;
  saved private.messages;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if p_message_id is null then
    raise exception 'message id required'
      using errcode = '22023';
  end if;

  select message.*
  into saved
  from private.messages as message
  where message.id = p_message_id;

  if saved.id is null then
    normalized_body := private.normalize_message_body(p_body);

    -- 나가기와 겹치지 않도록 내 현재 참여 기간을 잠근다. 아래에서 같은 행의 읽음 위치를 고치므로
    -- 처음부터 `no key update`로 잡는다. `share`로 잡으면 같은 사람이 동시에 보낸 두 전송이 서로의
    -- 잠금 승격을 기다리며 교착한다.
    perform 1
    from public.conversation_members as member
    where member.conversation_id = p_conversation_id
      and member.profile_id = caller_profile_id
      and member.left_at is null
    for no key update;

    if not found then
      raise exception 'conversation member required'
        using errcode = '42501';
    end if;

    if p_reply_to_id is not null and not exists (
      select 1
      from private.messages as original
      join public.conversation_members as period
        on period.conversation_id = original.conversation_id
        and period.profile_id = caller_profile_id
        and original.sent_at >= period.joined_at
        and (period.left_at is null or original.sent_at < period.left_at)
      where original.id = p_reply_to_id
        and original.conversation_id = p_conversation_id
        and original.deleted_at is null
    ) then
      raise exception 'reply target unavailable'
        using errcode = '22023';
    end if;

    select * into encrypted
    from private.encrypt_message_text(normalized_body, private.message_keys());

    -- 전송 시각은 잠금과 키 읽기를 마친 지금이다. 트랜잭션 시작 시각(`now()`)을 쓰면 늦게 커밋된
    -- 메시지가 이미 읽은 위치보다 앞에 놓여 읽지 않은 수와 페이지 순서에서 빠질 수 있다.
    insert into private.messages (
      id, conversation_id, sender_id, sent_at, reply_to_id, body_ciphertext, key_version
    ) values (
      p_message_id,
      p_conversation_id,
      caller_profile_id,
      clock_timestamp(),
      p_reply_to_id,
      encrypted.ciphertext,
      encrypted.key_version
    )
    on conflict on constraint messages_pkey do nothing
    returning * into saved;

    if saved.id is not null then
      perform private.enqueue_message_push(saved);

      update public.conversation_members as member
      set last_read_sent_at = saved.sent_at,
        last_read_message_id = saved.id
      where member.conversation_id = p_conversation_id
        and member.profile_id = caller_profile_id
        and member.left_at is null
        and (member.last_read_sent_at, member.last_read_message_id) < (saved.sent_at, saved.id);
    else
      -- 같은 ID를 동시에 보낸 다른 요청이 먼저 저장했다.
      select message.*
      into saved
      from private.messages as message
      where message.id = p_message_id;
    end if;
  end if;

  if saved.sender_id is distinct from caller_profile_id
    or saved.conversation_id <> p_conversation_id then
    raise exception 'message id already used'
      using errcode = '23505';
  end if;

  return query select saved.id, saved.sent_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_conversation_muted (
  p_conversation_id uuid,
  p_muted           boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if p_muted is null then
    raise exception 'muted state required'
      using errcode = '22023';
  end if;

  update public.conversation_members as member
  set muted_until = case when p_muted then 'infinity'::timestamptz end
  where member.conversation_id = p_conversation_id
    and member.profile_id = caller_profile_id
    and member.left_at is null;

  if not found then
    raise exception 'conversation member required'
      using errcode = '42501';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_conversation_muted"(uuid, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_my_message_preview_hidden (
  p_hidden boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_hidden is null then
    raise exception 'message preview setting must not be null' using errcode = '22023';
  end if;
  insert into public.notification_preferences as preference (profile_id, message_preview_hidden)
  values (caller_profile_id, p_hidden)
  on conflict (profile_id) do update set
    message_preview_hidden = excluded.message_preview_hidden,
    updated_at = now();
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_my_message_preview_hidden"(boolean) FROM PUBLIC, "anon";

ALTER TABLE "private"."notification_delivery_outbox"
  ADD CONSTRAINT "notification_delivery_outbox_message_channel" CHECK (((message_id IS NULL) OR (channel = 'web_push'::private.notification_delivery_channel)));

ALTER TABLE "private"."notification_delivery_outbox"
  ADD CONSTRAINT "notification_delivery_outbox_message_id_fkey" FOREIGN KEY (message_id) REFERENCES private.messages(id) ON DELETE CASCADE;

ALTER TABLE "private"."notification_delivery_outbox"
  ADD CONSTRAINT "notification_delivery_outbox_source" CHECK ((num_nonnulls(notification_id, message_id) = 1));

CREATE INDEX notification_delivery_message_pending_idx ON private.notification_delivery_outbox USING btree (subscription_id, message_id)
  WHERE ((message_id IS NOT NULL) AND (status = ANY (ARRAY['pending'::private.notification_delivery_status, 'leased'::private.notification_delivery_status])));

CREATE UNIQUE INDEX notification_delivery_message_push_unique_idx ON private.notification_delivery_outbox USING btree (message_id, subscription_id)
  WHERE (message_id IS NOT NULL);

CREATE POLICY "notification_dispatcher_wakes_deny_client" ON "private"."notification_dispatcher_wakes"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON FUNCTION "private"."enqueue_message_push"(private.messages) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."message_delivery_allowed"(private.notification_delivery_outbox) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."message_push_content"(uuid, bigint, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."wake_notification_dispatcher"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."claim_notification_deliveries"(integer, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_my_notification_preferences"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."next_message_delivery_at"(integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_conversation_muted"(uuid, boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_my_message_preview_hidden"(boolean) TO "authenticated";
