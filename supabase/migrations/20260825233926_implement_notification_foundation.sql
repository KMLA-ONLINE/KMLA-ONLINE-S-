-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE TYPE private.notification_delivery_channel AS ENUM (
  'web_push',
  'email'
);

CREATE TYPE private.notification_delivery_status AS ENUM (
  'pending',
  'leased',
  'sent',
  'suppressed',
  'dead'
);

CREATE FUNCTION private.cleanup_expired_notifications()
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
  return removed;
end;
$function$;

REVOKE ALL ON FUNCTION private.cleanup_expired_notifications() FROM PUBLIC;

CREATE FUNCTION private.enqueue_notification_email (
  p_notification_id uuid,
  p_recipient_email text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if nullif(btrim(p_recipient_email), '') is null then
    return false;
  end if;

  insert into private.notification_delivery_outbox (
    notification_id, recipient_profile_id, channel, recipient_email
  )
  select notification.id, notification.recipient_profile_id, 'email', btrim(p_recipient_email)
  from public.notifications as notification
  where notification.id = p_notification_id
  on conflict do nothing;
  return found;
end;
$function$;

REVOKE ALL ON FUNCTION private.enqueue_notification_email(uuid, text) FROM PUBLIC;

CREATE FUNCTION private.enqueue_notification_push (
  p_notification_id uuid
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target public.notifications;
  inserted_count integer;
begin
  select notification.* into target
  from public.notifications as notification
  where notification.id = p_notification_id;

  if target.id is null then
    return 0;
  end if;

  insert into private.notification_delivery_outbox (
    notification_id, recipient_profile_id, subscription_id, channel
  )
  select target.id, target.recipient_profile_id, subscription.id, 'web_push'
  from private.web_push_subscriptions as subscription
  where subscription.profile_id = target.recipient_profile_id
    and private.notification_push_allowed(
      target, subscription.created_at, subscription.expiration_time
    )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;

REVOKE ALL ON FUNCTION private.enqueue_notification_push(uuid) FROM PUBLIC;

CREATE FUNCTION private.invoke_notification_dispatcher()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  project_url text;
  dispatcher_secret text;
  request_id bigint;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into dispatcher_secret
  from vault.decrypted_secrets where name = 'notification_dispatch_secret';
  if project_url is null or dispatcher_secret is null then return null; end if;
  select net.http_post(
    url := project_url || '/functions/v1/dispatch-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', dispatcher_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  ) into request_id;
  return request_id;
end;
$function$;

REVOKE ALL ON FUNCTION private.invoke_notification_dispatcher() FROM PUBLIC;

CREATE FUNCTION private.notify_comment_created()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor_profile_id bigint := private.current_profile_id();
  recipient_profile_id bigint;
  target_post public.posts;
  actor_profile public.profiles;
  actor_identity public.notification_actor_identity := new.author_identity::text::public.notification_actor_identity;
  notification_title text;
begin
  if actor_profile_id is null then return new; end if;
  select post.* into target_post from public.posts as post where post.id = new.post_id;
  if target_post.id is null
    or (target_post.kind = 'profile' and target_post.visibility = 'private') then
    return new;
  end if;

  if new.parent_comment_id is not null then
    select author.profile_id into recipient_profile_id
    from private.comment_authors as author
    where author.comment_id = new.parent_comment_id;
    notification_title := '내 댓글에 새 답글이 등록되었습니다.';
  else
    select author.profile_id into recipient_profile_id
    from private.post_authors as author
    where author.post_id = new.post_id;
    notification_title := '내 게시물에 새 댓글이 등록되었습니다.';
  end if;

  select profile.* into actor_profile
  from public.profiles as profile where profile.id = actor_profile_id;
  perform private.emit_notification(
    'comment:' || new.id::text,
    recipient_profile_id,
    (case when new.parent_comment_id is null then 'post_commented' else 'comment_replied' end)::public.notification_kind,
    'normal', 'content', actor_identity, actor_profile_id,
    case actor_identity
      when 'identified' then coalesce(actor_profile.name, '탈퇴한 사용자')
      when 'anonymous' then '익명'
      else '운영진'
    end,
    case when actor_identity = 'identified' then actor_profile.avatar_path end,
    notification_title, target_post.group_id, new.post_id, new.id,
    target_post.timeline_profile_id
  );
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION private.notify_comment_created() FROM PUBLIC;

CREATE FUNCTION private.notify_group_changed()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor_profile_id bigint := private.current_profile_id();
  recipient record;
  event_kind public.notification_kind;
  event_importance public.notification_importance;
  event_title text;
begin
  if actor_profile_id is null then return new; end if;
  if old.deleted_at is null and new.deleted_at is not null then
    event_kind := 'group_deleted';
    event_importance := 'high';
    event_title := '그룹이 영구 삭제되었습니다.';
  elsif old.join_policy is distinct from new.join_policy
    or old.identity_policy is distinct from new.identity_policy
    or old.posting_policy is distinct from new.posting_policy then
    event_kind := 'group_policy_changed';
    event_importance := 'normal';
    event_title := '그룹 운영 정책이 변경되었습니다.';
  else
    return new;
  end if;

  for recipient in select profile_id from public.group_memberships where group_id = new.id
  loop
    perform private.emit_notification(
      'group-change:' || new.id::text || ':' || txid_current()::text || ':' || recipient.profile_id::text,
      recipient.profile_id, event_kind, event_importance, 'group', 'staff',
      actor_profile_id, '운영진', null, event_title, new.id
    );
  end loop;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION private.notify_group_changed() FROM PUBLIC;

CREATE FUNCTION private.notify_group_join_requested()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor_profile public.profiles;
  recipient record;
begin
  if private.current_profile_id() is null then return new; end if;
  select profile.* into actor_profile
  from public.profiles as profile where profile.id = new.profile_id;
  for recipient in
    select membership.profile_id
    from public.group_memberships as membership
    where membership.group_id = new.group_id and membership.role in ('owner', 'admin')
  loop
    perform private.emit_notification(
      'group-join-request:' || new.id::text || ':recipient:' || recipient.profile_id::text,
      recipient.profile_id, 'group_join_requested', 'normal', 'group', 'identified',
      new.profile_id, actor_profile.name, actor_profile.avatar_path,
      '새 그룹 가입 요청이 있습니다.', new.group_id
    );
  end loop;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION private.notify_group_join_requested() FROM PUBLIC;

CREATE FUNCTION private.notify_official_group_joined()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  group_record public.groups;
begin
  select group_data.* into group_record
  from public.groups as group_data where group_data.id = new.group_id;
  if group_record.kind = 'official'
    and private.current_profile_id() is not null
    and private.current_profile_id() is distinct from new.profile_id then
    perform private.emit_notification(
      'official-group-joined:' || new.group_id::text || ':' || new.profile_id::text,
      new.profile_id, 'official_group_joined', 'normal', 'group', 'system', null,
      group_record.name, null, '공식 그룹에 자동 가입되었습니다.', new.group_id
    );
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION private.notify_official_group_joined() FROM PUBLIC;

CREATE FUNCTION private.notify_post_published()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor_profile_id bigint := private.current_profile_id();
  actor_profile public.profiles;
  actor_identity public.notification_actor_identity := new.author_identity::text::public.notification_actor_identity;
  recipient record;
begin
  if new.published_at is null or (tg_op = 'UPDATE' and old.published_at is not null)
    or (new.kind = 'profile' and new.visibility = 'private') then
    return new;
  end if;
  if actor_profile_id is null then return new; end if;
  select profile.* into actor_profile
  from public.profiles as profile where profile.id = actor_profile_id;

  if new.kind = 'group' then
    for recipient in
      select membership.profile_id
      from public.group_memberships as membership
      where membership.group_id = new.group_id
        and membership.notification_level = 'all'
    loop
      perform private.emit_notification(
        'group-post:' || new.id::text || ':recipient:' || recipient.profile_id::text,
        recipient.profile_id, 'group_posted', 'low', 'group', actor_identity,
        actor_profile_id,
        case actor_identity
          when 'identified' then coalesce(actor_profile.name, '탈퇴한 사용자')
          when 'anonymous' then '익명'
          else '운영진'
        end,
        case when actor_identity = 'identified' then actor_profile.avatar_path end,
        new.title, new.group_id, new.id
      );
    end loop;
  elsif new.timeline_profile_id <> actor_profile_id then
    perform private.emit_notification(
      'timeline-post:' || new.id::text,
      new.timeline_profile_id, 'timeline_posted', 'normal', 'timeline', 'identified',
      actor_profile_id, coalesce(actor_profile.name, '탈퇴한 사용자'), actor_profile.avatar_path,
      '내 타임라인에 새 게시물이 등록되었습니다.', null, new.id, null,
      new.timeline_profile_id
    );
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION private.notify_post_published() FROM PUBLIC;

CREATE FUNCTION private.notify_profile_changed()
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
    event_kind := case new.status
      when 'accepted' then 'account_approved'
      when 'blocked' then 'account_blocked'
      else 'account_unblocked'
    end;
    event_importance := 'high';
    event_title := case new.status
      when 'accepted' then '가입이 승인되었습니다.'
      when 'blocked' then '가입이 차단되었습니다.'
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

REVOKE ALL ON FUNCTION private.notify_profile_changed() FROM PUBLIC;

CREATE FUNCTION private.notify_profile_permission_changed()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target_profile_id bigint := coalesce(new.profile_id, old.profile_id);
  actor_profile_id bigint := private.current_profile_id();
begin
  if actor_profile_id is null then return coalesce(new, old); end if;
  if coalesce(new.permission_key, old.permission_key) = 'gongang.manage' then
    perform private.emit_notification(
      'gongang-manager:' || target_profile_id::text || ':' || txid_current()::text,
      target_profile_id,
      (case when tg_op = 'INSERT' then 'gongang_manager_granted' else 'gongang_manager_revoked' end)::public.notification_kind,
      'normal', 'account', 'staff', actor_profile_id, '운영진', null,
      case when tg_op = 'INSERT'
        then '공강 관리 권한이 부여되었습니다.'
        else '공강 관리 권한이 해제되었습니다.'
      end,
      null, null, null, target_profile_id
    );
  end if;
  return coalesce(new, old);
end;
$function$;

REVOKE ALL ON FUNCTION private.notify_profile_permission_changed() FROM PUBLIC;

CREATE FUNCTION private.notify_reaction_created()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  recipient_profile_id bigint;
  target_post public.posts;
  actor_profile public.profiles;
  target_comment_id uuid;
  target_post_id uuid;
  notification_kind public.notification_kind;
  aggregate_key text;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'post_reactions' then
    target_post_id := new.post_id;
    notification_kind := 'post_reacted';
    aggregate_key := 'post-reactions:' || new.post_id::text;
    select author.profile_id into recipient_profile_id
    from private.post_authors as author where author.post_id = new.post_id;
  else
    target_comment_id := new.comment_id;
    notification_kind := 'comment_reacted';
    aggregate_key := 'comment-reactions:' || new.comment_id::text;
    select comment.post_id, author.profile_id
    into target_post_id, recipient_profile_id
    from public.post_comments as comment
    join private.comment_authors as author on author.comment_id = comment.id
    where comment.id = new.comment_id and comment.deleted_at is null;
  end if;

  select post.* into target_post from public.posts as post where post.id = target_post_id;
  if target_post.id is null or target_post.deleted_at is not null
    or (target_post.kind = 'profile' and target_post.visibility = 'private') then
    return new;
  end if;
  select profile.* into actor_profile
  from public.profiles as profile where profile.id = new.profile_id;
  perform private.emit_notification(
    aggregate_key || ':actor:' || new.profile_id::text,
    recipient_profile_id, notification_kind, 'low', 'content', 'identified',
    new.profile_id, coalesce(actor_profile.name, '탈퇴한 사용자'), actor_profile.avatar_path,
    '새 반응이 등록되었습니다.', target_post.group_id, target_post_id,
    target_comment_id, target_post.timeline_profile_id, null, aggregate_key
  );
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION private.notify_reaction_created() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.prepare_gongang_schedule()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  korea_today date;
  next_monday date;
  next_sunday date;
  lock_key bigint;
  preempted record;
begin
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  join public.profile_permissions as permission
    on permission.profile_id = profile.id
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and permission.permission_key = 'gongang.manage';

  if not found then
    raise exception 'gongang manager permission required'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (
    old.schedule_date is distinct from new.schedule_date
    or old.slot is distinct from new.slot
    or old.location is distinct from new.location
  ) then
    raise exception 'gongang schedule keys cannot be changed'
      using errcode = '22023';
  end if;

  korea_today := (now() at time zone 'Asia/Seoul')::date;
  next_monday :=
    korea_today + (8 - extract(isodow from korea_today)::integer);
  next_sunday := next_monday + 6;

  if new.schedule_date < next_monday
    or new.schedule_date > next_sunday
  then
    raise exception 'only next week can be configured'
      using errcode = '22023';
  end if;

  new.configured_by := caller_profile_id;
  new.updated_at := now();

  if new.reserved = false then
    new.detail := null;
  else
    new.detail := btrim(new.detail);
  end if;

  lock_key :=
    pg_catalog.hashtextextended(
      pg_catalog.concat_ws(
        '|',
        'gongang',
        new.slot,
        new.location,
        extract(dow from new.schedule_date)::integer::text
      ),
      0
    );

  perform pg_catalog.pg_advisory_xact_lock(lock_key);

  if new.reserved and exists (
    select 1
    from public.utility_reservations as reservation
    where reservation.mode = 'gongang'
      and reservation.recurring = false
      and reservation.reservation_date = new.schedule_date
      and reservation.slot = new.slot
      and reservation.location = new.location
  ) then
    raise exception 'reservation slot is already occupied'
      using errcode = '23505';
  end if;

  if new.reserved then
    for preempted in
      update public.utility_reservations as reservation
      set recurring_until = new.schedule_date
      where reservation.mode = 'gongang'
        and reservation.recurring = true
        and reservation.slot = new.slot
        and reservation.location = new.location
        and reservation.reservation_date <= new.schedule_date
        and (
          reservation.recurring_until is null
          or reservation.recurring_until > new.schedule_date
        )
        and extract(dow from reservation.reservation_date)
          = extract(dow from new.schedule_date)
      returning reservation.id, reservation.profile_id
    loop
      perform private.emit_notification(
        'gongang-preempted:' || preempted.id::text || ':' || new.schedule_date::text,
        preempted.profile_id, 'gongang_preempted', 'high', 'school', 'staff',
        caller_profile_id, '운영진', null,
        '관리자 선예약으로 장기 공강 예약이 종료되었습니다.',
        null, null, null, null, preempted.id
      );
    end loop;
  end if;

  return new;
end;
$function$;

CREATE FUNCTION private.prepare_group_notification_preferences()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if exists (
    select 1 from public.groups as group_record
    where group_record.id = new.group_id and group_record.kind = 'official'
  ) then
    new.notification_level := 'all';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION private.prepare_group_notification_preferences() FROM PUBLIC;

CREATE TABLE private.notification_delivery_attempts (
  id           bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  delivery_id  uuid                     NOT NULL,
  attempted_at timestamp with time zone DEFAULT now() NOT NULL,
  outcome      text                     NOT NULL,
  status_code  integer,
  error_code   text
);

ALTER TABLE private.notification_delivery_attempts
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.notification_delivery_attempts
  ADD CONSTRAINT notification_delivery_attempts_outcome CHECK (outcome = ANY (ARRAY['sent'::text, 'suppressed'::text, 'retry'::text, 'dead'::text, 'gone'::text]));

ALTER TABLE private.notification_delivery_attempts
  ADD CONSTRAINT notification_delivery_attempts_pkey PRIMARY KEY (id);

CREATE POLICY notification_delivery_attempts_deny_client ON private.notification_delivery_attempts
  USING (false)
  WITH CHECK (false);

CREATE TABLE private.notification_delivery_outbox (
  id                   uuid                                  DEFAULT gen_random_uuid() NOT NULL,
  notification_id      uuid,
  recipient_profile_id bigint                                NOT NULL,
  subscription_id      uuid,
  channel              private.notification_delivery_channel NOT NULL,
  status               private.notification_delivery_status  DEFAULT 'pending'::private.notification_delivery_status NOT NULL,
  recipient_email      text,
  available_at         timestamp with time zone              DEFAULT now() NOT NULL,
  attempt_count        integer                               DEFAULT 0 NOT NULL,
  lease_id             uuid,
  lease_expires_at     timestamp with time zone,
  last_status_code     integer,
  last_error_code      text,
  created_at           timestamp with time zone              DEFAULT now() NOT NULL,
  completed_at         timestamp with time zone
);

ALTER TABLE private.notification_delivery_outbox
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.notification_delivery_outbox
  ADD CONSTRAINT notification_delivery_outbox_attempts CHECK (attempt_count >= 0 AND attempt_count <= 10);

ALTER TABLE private.notification_delivery_outbox
  ADD CONSTRAINT notification_delivery_outbox_channel_shape CHECK (channel = 'web_push'::private.notification_delivery_channel AND subscription_id IS
    NOT NULL AND recipient_email IS NULL OR channel = 'email'::private.notification_delivery_channel AND subscription_id IS NULL AND recipient_email IS NOT NULL);

ALTER TABLE private.notification_delivery_outbox
  ADD CONSTRAINT notification_delivery_outbox_completion_shape
    CHECK
    ((status = ANY (ARRAY['sent'::private.notification_delivery_status, 'suppressed'::private.notification_delivery_status, 'dead'::private.notification_delivery_status])) =
    (completed_at IS NOT NULL));

ALTER TABLE private.notification_delivery_outbox
  ADD CONSTRAINT notification_delivery_outbox_lease_shape CHECK (status = 'leased'::private.notification_delivery_status AND lease_id IS NOT NULL AND lease_expires_at IS
    NOT NULL OR status <> 'leased'::private.notification_delivery_status AND lease_id IS NULL AND lease_expires_at IS NULL);

ALTER TABLE private.notification_delivery_outbox
  ADD CONSTRAINT notification_delivery_outbox_pkey PRIMARY KEY (id);

ALTER TABLE private.notification_delivery_attempts
  ADD CONSTRAINT notification_delivery_attempts_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES private.notification_delivery_outbox(id) ON DELETE CASCADE;

ALTER TABLE private.notification_delivery_outbox
  ADD CONSTRAINT notification_delivery_outbox_recipient_profile_id_fkey FOREIGN KEY (recipient_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX notification_delivery_email_unique_idx ON private.notification_delivery_outbox (notification_id, channel)
  WHERE channel = 'email'::private.notification_delivery_channel;

CREATE INDEX notification_delivery_claim_idx ON private.notification_delivery_outbox (available_at, created_at, id)
  WHERE status = ANY (ARRAY['pending'::private.notification_delivery_status, 'leased'::private.notification_delivery_status]);

CREATE UNIQUE INDEX notification_delivery_push_unique_idx ON private.notification_delivery_outbox (notification_id, subscription_id, channel)
  WHERE channel = 'web_push'::private.notification_delivery_channel;

CREATE POLICY notification_delivery_outbox_deny_client ON private.notification_delivery_outbox
  USING (false)
  WITH CHECK (false);

CREATE TABLE private.notification_event_keys (
  event_key       text                     NOT NULL,
  notification_id uuid,
  created_at      timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE private.notification_event_keys
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.notification_event_keys
  ADD CONSTRAINT notification_event_keys_length CHECK (char_length(event_key) >= 3 AND char_length(event_key) <= 300);

ALTER TABLE private.notification_event_keys
  ADD CONSTRAINT notification_event_keys_pkey PRIMARY KEY (event_key);

CREATE INDEX notification_event_keys_notification_idx ON private.notification_event_keys (notification_id);

CREATE POLICY notification_event_keys_deny_client ON private.notification_event_keys
  USING (false)
  WITH CHECK (false);

CREATE TABLE private.web_push_subscriptions (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  profile_id bigint                   NOT NULL,
  endpoint   text                     NOT NULL,
  p256dh     text                     NOT NULL,
  auth       text                     NOT NULL,
  expiration_time timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE private.web_push_subscriptions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.web_push_subscriptions
  ADD CONSTRAINT web_push_subscriptions_endpoint_key UNIQUE (endpoint);

ALTER TABLE private.web_push_subscriptions
  ADD CONSTRAINT web_push_subscriptions_endpoint_length CHECK (char_length(endpoint) >= 12 AND char_length(endpoint) <= 2048);

ALTER TABLE private.web_push_subscriptions
  ADD CONSTRAINT web_push_subscriptions_key_length CHECK (char_length(p256dh) >= 20 AND char_length(p256dh) <= 256 AND char_length(auth) >= 8 AND char_length(auth) <= 128);

ALTER TABLE private.web_push_subscriptions
  ADD CONSTRAINT web_push_subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE private.notification_delivery_outbox
  ADD CONSTRAINT notification_delivery_outbox_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES private.web_push_subscriptions(id) ON DELETE CASCADE;

ALTER TABLE private.web_push_subscriptions
  ADD CONSTRAINT web_push_subscriptions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX web_push_subscriptions_profile_idx ON private.web_push_subscriptions (profile_id, created_at);

CREATE POLICY web_push_subscriptions_deny_client ON private.web_push_subscriptions
  USING (false)
  WITH CHECK (false);

CREATE TYPE public.group_notification_level AS ENUM (
  'none',
  'direct',
  'all'
);

CREATE TYPE public.notification_actor_identity AS ENUM (
  'identified',
  'anonymous',
  'staff',
  'system'
);

CREATE TYPE public.notification_category AS ENUM (
  'content',
  'timeline',
  'group',
  'account',
  'school',
  'moderation'
);

CREATE TYPE public.notification_importance AS ENUM (
  'low',
  'normal',
  'high'
);

CREATE TYPE public.notification_kind AS ENUM (
  'post_commented',
  'comment_replied',
  'post_reacted',
  'comment_reacted',
  'timeline_posted',
  'timeline_post_deleted',
  'group_posted',
  'group_join_requested',
  'group_join_approved',
  'group_join_rejected',
  'group_role_changed',
  'group_ownership_transferred',
  'official_group_joined',
  'group_policy_changed',
  'group_deleted',
  'post_moderated',
  'comment_moderated',
  'application_submitted',
  'account_approved',
  'account_blocked',
  'account_unblocked',
  'app_admin_granted',
  'app_admin_revoked',
  'gongang_manager_granted',
  'gongang_manager_revoked',
  'gongang_preempted'
);

CREATE FUNCTION private.emit_notification (
  p_event_key            text,
  p_recipient_profile_id bigint,
  p_kind                 public.notification_kind,
  p_importance           public.notification_importance,
  p_category             public.notification_category,
  p_actor_identity       public.notification_actor_identity,
  p_actor_profile_id     bigint,
  p_actor_display_name   text,
  p_actor_avatar_path    text,
  p_title                text,
  p_group_id             uuid                               DEFAULT NULL::uuid,
  p_post_id              uuid                               DEFAULT NULL::uuid,
  p_comment_id           uuid                               DEFAULT NULL::uuid,
  p_target_profile_id    bigint                             DEFAULT NULL::bigint,
  p_reservation_id       bigint                             DEFAULT NULL::bigint,
  p_aggregate_key        text                               DEFAULT NULL::text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  created_notification_id uuid;
begin
  if p_recipient_profile_id is null
    or p_event_key is null
    or p_actor_profile_id = p_recipient_profile_id then
    return null;
  end if;

  if p_group_id is not null and p_category = 'content' and exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = p_recipient_profile_id
      and membership.notification_level = 'none'
  ) then
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(coalesce(p_aggregate_key, p_event_key), 0)
  );

  insert into private.notification_event_keys (event_key)
  values (p_event_key)
  on conflict do nothing;
  if not found then
    select event.notification_id into created_notification_id
    from private.notification_event_keys as event
    where event.event_key = p_event_key;
    return created_notification_id;
  end if;

  if p_aggregate_key is not null then
    select event.notification_id into created_notification_id
    from private.notification_event_keys as event
    where event.event_key = p_aggregate_key
    for update;
  end if;

  if created_notification_id is not null then
    update public.notifications
    set actor_identity = p_actor_identity,
      actor_profile_id = case when p_actor_identity = 'identified' then p_actor_profile_id end,
      actor_display_name = p_actor_display_name,
      actor_avatar_path = p_actor_avatar_path,
      actor_count = actor_count + 1,
      last_activity_at = now(),
      read_at = null
    where id = created_notification_id;
  else
    insert into public.notifications (
      recipient_profile_id, kind, importance, category, actor_identity,
      actor_profile_id, actor_display_name, actor_avatar_path, group_id, post_id,
      comment_id, target_profile_id, reservation_id, title
    ) values (
      p_recipient_profile_id, p_kind, p_importance, p_category, p_actor_identity,
      case when p_actor_identity = 'identified' then p_actor_profile_id end,
      p_actor_display_name, p_actor_avatar_path, p_group_id, p_post_id,
      p_comment_id, p_target_profile_id, p_reservation_id, btrim(p_title)
    ) returning id into created_notification_id;

    if p_aggregate_key is not null then
      insert into private.notification_event_keys (event_key, notification_id)
      values (p_aggregate_key, created_notification_id)
      on conflict (event_key) do update set notification_id = excluded.notification_id;
    end if;

    perform private.enqueue_notification_push(created_notification_id);
  end if;

  update private.notification_event_keys as event
  set notification_id = created_notification_id
  where event.event_key = p_event_key;

  return created_notification_id;
end;
$function$;

REVOKE ALL ON FUNCTION
  private.emit_notification(text, bigint, public.notification_kind, public.notification_importance, public.notification_category, public.notification_actor_identity, bigint, text,
  text, text, uuid, uuid, uuid, bigint, bigint, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.approve_group_join_request (
  p_group_id   uuid,
  p_request_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  requested_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = p_group_id for update;

  if not exists (
    select 1
    from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
      and caller_membership.role in ('owner', 'admin')
  ) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  delete from public.group_join_requests as join_request
  where join_request.group_id = p_group_id
    and join_request.id = p_request_id
  returning join_request.profile_id into requested_profile_id;

  if requested_profile_id is null then
    raise exception 'join request not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = requested_profile_id
      and profile.status = 'accepted'
      and profile.type in ('student', 'alumni')
      and profile.deleted_at is null
  ) then
    raise exception 'requesting profile is no longer eligible' using errcode = '55000';
  end if;

  insert into public.group_memberships (group_id, profile_id, role)
  values (p_group_id, requested_profile_id, 'member')
  on conflict on constraint group_memberships_pkey do nothing;

  perform private.emit_notification(
    'group-join-approved:' || p_request_id::text,
    requested_profile_id, 'group_join_approved', 'normal', 'group', 'staff',
    caller_profile_id, '운영진', null, '그룹 가입 요청이 승인되었습니다.', p_group_id
  );
end;
$function$;

CREATE FUNCTION public.claim_notification_deliveries (
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
    and delivery.status in ('pending', 'leased')
    and delivery.available_at <= now()
    and not exists (
      select 1
      from public.notifications as notification
      join private.web_push_subscriptions as subscription
        on subscription.id = delivery.subscription_id
      where notification.id = delivery.notification_id
        and subscription.profile_id = delivery.recipient_profile_id
        and private.notification_push_allowed(
          notification, subscription.created_at, subscription.expiration_time
        )
        and (
          notification.category = 'moderation'
          or notification.kind in ('group_deleted', 'account_approved', 'account_blocked', 'account_unblocked')
          or (
            notification.post_id is not null
            and exists (
              select 1
              from public.posts as post
              where post.id = notification.post_id
                and post.deleted_at is null
                and (
                  (post.kind = 'group' and exists (
                    select 1 from public.group_memberships as membership
                    where membership.group_id = post.group_id
                      and membership.profile_id = delivery.recipient_profile_id
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
                and membership.profile_id = delivery.recipient_profile_id
                and group_record.deleted_at is null
            )
          )
          or (notification.post_id is null and notification.group_id is null)
        )
    );
  return query
  with candidates as (
    select delivery.id
    from private.notification_delivery_outbox as delivery
    where (
        delivery.status = 'pending'
        or (delivery.status = 'leased' and delivery.lease_expires_at <= now())
      )
      and delivery.available_at <= now()
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
  )
  select claimed.id, claimed.lease_id, claimed.channel,
    subscription.endpoint, subscription.p256dh, subscription.auth,
    claimed.recipient_email, notification.id,
    notification.title,
    case notification.kind
      when 'post_commented' then '내 게시물에 새 댓글이 등록되었습니다.'
      when 'comment_replied' then '내 댓글에 새 답글이 등록되었습니다.'
      when 'group_posted' then '그룹에 새 게시물이 등록되었습니다.'
      when 'account_approved' then '가입이 승인되었습니다.'
      when 'account_blocked' then '가입이 차단되었습니다.'
      when 'account_unblocked' then '차단이 해제되었습니다.'
      else '새 알림이 있습니다.'
    end,
    'notification:' || notification.id::text
  from claimed
  left join private.web_push_subscriptions as subscription
    on subscription.id = claimed.subscription_id
  left join public.notifications as notification
    on notification.id = claimed.notification_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.claim_notification_deliveries(integer, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.claim_notification_deliveries(integer, integer) TO service_role;

CREATE FUNCTION public.complete_notification_delivery (
  p_delivery_id uuid,
  p_lease_id    uuid,
  p_outcome     text,
  p_status_code integer DEFAULT NULL::integer,
  p_error_code  text    DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target private.notification_delivery_outbox;
begin
  if p_outcome not in ('sent', 'suppressed', 'retry', 'dead', 'gone') then
    raise exception 'invalid notification delivery outcome' using errcode = '22023';
  end if;
  select delivery.* into target
  from private.notification_delivery_outbox as delivery
  where delivery.id = p_delivery_id and delivery.status = 'leased'
    and delivery.lease_id = p_lease_id and delivery.lease_expires_at > now()
  for update;
  if target.id is null then return false; end if;

  insert into private.notification_delivery_attempts (
    delivery_id, outcome, status_code, error_code
  ) values (target.id, p_outcome, p_status_code, left(p_error_code, 80));

  if p_outcome = 'gone' then
    delete from private.web_push_subscriptions where id = target.subscription_id;
    return true;
  elsif p_outcome = 'retry' and target.attempt_count < 5 then
    update private.notification_delivery_outbox
    set status = 'pending', lease_id = null, lease_expires_at = null,
      available_at = now() + make_interval(secs => least(3600, 15 * (2 ^ target.attempt_count)::integer)),
      last_status_code = p_status_code, last_error_code = left(p_error_code, 80)
    where id = target.id;
  else
    update private.notification_delivery_outbox
    set status = case
        when p_outcome = 'sent' then 'sent'::private.notification_delivery_status
        when p_outcome = 'suppressed' then 'suppressed'::private.notification_delivery_status
        else 'dead'::private.notification_delivery_status
      end,
      lease_id = null, lease_expires_at = null, completed_at = now(),
      last_status_code = p_status_code, last_error_code = left(p_error_code, 80)
    where id = target.id;
  end if;
  return true;
end;
$function$;

REVOKE ALL ON FUNCTION public.complete_notification_delivery(uuid, uuid, text, integer, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.complete_notification_delivery(uuid, uuid, text, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_group_post (
  p_post_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  caller_role public.group_member_role;
  author_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record from public.posts as post
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null
  for update;
  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = post_record.group_id
    and membership.profile_id = caller_profile_id;
  if post_record.id is null or caller_role is null then
    raise exception 'post not found or not accessible' using errcode = '42501';
  end if;
  if caller_role not in ('owner', 'admin') and not private.is_post_author(p_post_id) then
    raise exception 'post deletion is not allowed' using errcode = '42501';
  end if;
  select author.profile_id into author_profile_id
  from private.post_authors as author where author.post_id = p_post_id;
  update public.posts set deleted_at = now(), pinned_at = null where id = p_post_id;
  update public.post_attachments
  set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
    cleanup_lease_expires_at = null
  where post_id = p_post_id and status <> 'deleted';
  if caller_profile_id <> author_profile_id then
    perform private.emit_notification(
      'post-moderated:' || p_post_id::text,
      author_profile_id, 'post_moderated', 'high', 'moderation', 'staff',
      caller_profile_id, '운영진', null, '게시물이 운영자에 의해 삭제되었습니다.',
      post_record.group_id
    );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_group (
  p_group_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_group public.groups;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  select group_record.* into target_group
  from public.groups as group_record
  where group_record.id = p_group_id and group_record.deleted_at is null
  for update;
  if target_group.id is null then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = caller_profile_id
      and membership.role = 'owner'
  ) then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  -- 공식 그룹은 소유자도 지울 수 없다. 승인된 재학생이 자동으로 가입하는 학교의 공간이라
  -- 한 사람의 결정으로 사라져서는 안 된다. 사용자가 공식 그룹에서 나갈 수 없는 것과 같은 이유다.
  if target_group.kind = 'official' then
    raise exception 'official groups cannot be deleted' using errcode = '55000';
  end if;

  update public.groups
  set deleted_at = now(), icon_path = null, cover_path = null
  where id = p_group_id;

  -- 저장소를 돌려받는다. 청소 워커가 집어 갈 수 있게 tombstone만 찍고 객체는 건드리지 않는다.
  update public.group_media_objects
  set status = 'deleted', deleted_at = now(),
    cleanup_lease_id = null, cleanup_lease_expires_at = null
  where group_id = p_group_id and status <> 'deleted';

  update public.post_attachments as attachment
  set status = 'deleted', deleted_at = now(),
    cleanup_lease_id = null, cleanup_lease_expires_at = null
  where attachment.status <> 'deleted'
    and exists (
      select 1 from public.posts as post
      where post.id = attachment.post_id and post.group_id = p_group_id
    );

  update public.posts
  set deleted_at = now(), pinned_at = null
  where group_id = p_group_id and deleted_at is null;

  delete from public.group_join_requests where group_id = p_group_id;
  delete from public.group_memberships where group_id = p_group_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_post_comment (
  p_comment_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  comment_record public.post_comments;
  target_post_id uuid;
  comment_group_id uuid;
  caller_role public.group_member_role;
  author_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select comment.post_id into target_post_id
  from public.post_comments as comment
  where comment.id = p_comment_id;
  if target_post_id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.posts as post
  where post.id = target_post_id
  for update;

  select comment.* into comment_record
  from public.post_comments as comment
  where comment.id = p_comment_id
    and comment.post_id = target_post_id
    and comment.deleted_at is null
  for update;
  if comment_record.id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  select post.group_id into comment_group_id
  from public.posts as post
  where post.id = comment_record.post_id;

  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = comment_group_id
    and membership.profile_id = caller_profile_id;

  if not exists (
    select 1 from private.comment_authors as author
    where author.comment_id = p_comment_id and author.profile_id = caller_profile_id
  ) and coalesce(caller_role, 'member') not in ('owner', 'admin') then
    raise exception 'only the author or a group moderator can delete a comment'
      using errcode = '42501';
  end if;

  select author.profile_id into author_profile_id
  from private.comment_authors as author where author.comment_id = p_comment_id;

  if comment_record.depth = 0 then
    -- 최상위 댓글을 지우면 답글 묶음 전체가 사라진다(기능 명세 §9.4).
    perform 1
    from public.post_comments as comment
    where comment.root_comment_id = p_comment_id
      and comment.deleted_at is null
    order by comment.id
    for update;

    update public.post_comments as comment
    set deleted_at = now()
    where comment.root_comment_id = p_comment_id and comment.deleted_at is null;
  else
    update public.post_comments as comment
    set deleted_at = now()
    where comment.id = p_comment_id;
  end if;
  if caller_profile_id <> author_profile_id then
    perform private.emit_notification(
      'comment-moderated:' || p_comment_id::text,
      author_profile_id, 'comment_moderated', 'high', 'moderation', 'staff',
      caller_profile_id, '운영진', null, '댓글이 운영자에 의해 삭제되었습니다.',
      comment_group_id, target_post_id
    );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_profile_post (
  p_post_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  author_profile_id bigint;
  caller_profile public.profiles;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'profile' and post.deleted_at is null
  for update;
  if post_record.id is null then
    raise exception 'post not found or not accessible' using errcode = '42501';
  end if;
  if not private.is_post_author(p_post_id)
    and post_record.timeline_profile_id <> caller_profile_id then
    raise exception 'post deletion is not allowed' using errcode = '42501';
  end if;

  select author.profile_id into author_profile_id
  from private.post_authors as author where author.post_id = p_post_id;
  select profile.* into caller_profile
  from public.profiles as profile where profile.id = caller_profile_id;

  update public.posts set deleted_at = now() where id = p_post_id;
  update public.post_attachments
  set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
    cleanup_lease_expires_at = null
  where post_id = p_post_id and status <> 'deleted';
  if caller_profile_id = post_record.timeline_profile_id
    and caller_profile_id <> author_profile_id then
    perform private.emit_notification(
      'timeline-post-deleted:' || p_post_id::text,
      author_profile_id, 'timeline_post_deleted', 'normal', 'timeline', 'identified',
      caller_profile_id, caller_profile.name, caller_profile.avatar_path,
      '타임라인 게시물이 삭제되었습니다.',
      null, null, null, post_record.timeline_profile_id
    );
  end if;
end;
$function$;

CREATE FUNCTION public.get_my_notification_preferences()
  RETURNS TABLE (
    content_push_enabled  boolean,
    timeline_push_enabled boolean,
    group_push_enabled    boolean,
    account_push_enabled  boolean,
    school_push_enabled   boolean
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
    preference.school_push_enabled
  from public.notification_preferences as preference
  where preference.profile_id = caller_profile_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_my_notification_preferences() FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_my_notification_preferences() TO authenticated;

CREATE FUNCTION public.get_my_recent_unread_notification_count()
  RETURNS bigint
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  return (
    select count(*)
    from public.notifications as notification
    where notification.recipient_profile_id = private.current_profile_id()
      and notification.read_at is null
      and notification.last_activity_at > now() - interval '24 hours'
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_my_recent_unread_notification_count() FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_my_recent_unread_notification_count() TO authenticated;

CREATE FUNCTION public.get_my_web_push_status (
  p_endpoint text
)
  RETURNS TABLE (
    subscribed boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  return query select exists (
    select 1 from private.web_push_subscriptions as subscription
    where subscription.endpoint = p_endpoint
      and subscription.profile_id = private.current_profile_id()
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_my_web_push_status(text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_my_web_push_status(text) TO authenticated;

CREATE FUNCTION public.list_my_notifications (
  p_before_last_activity_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_before_id               uuid                     DEFAULT NULL::uuid,
  p_limit                   integer                  DEFAULT 20
)
  RETURNS TABLE (
    id                 uuid,
    kind               public.notification_kind,
    importance         public.notification_importance,
    category           public.notification_category,
    actor_identity     public.notification_actor_identity,
    actor_display_name text,
    actor_avatar_path  text,
    actor_count        integer,
    group_id           uuid,
    post_id            uuid,
    comment_id         uuid,
    target_profile_id  bigint,
    reservation_id     bigint,
    title              text,
    created_at         timestamp with time zone,
    last_activity_at   timestamp with time zone,
    read_at            timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 50 then
    raise exception 'notification page limit must be between 1 and 50' using errcode = '22023';
  end if;
  if (p_before_last_activity_at is null) <> (p_before_id is null) then
    raise exception 'notification cursor must be complete' using errcode = '22023';
  end if;

  return query
  select notification.id, notification.kind, notification.importance,
    notification.category, notification.actor_identity,
    notification.actor_display_name, notification.actor_avatar_path,
    notification.actor_count, notification.group_id, notification.post_id,
    notification.comment_id, notification.target_profile_id,
    notification.reservation_id,
    notification.title, notification.created_at, notification.last_activity_at,
    notification.read_at
  from public.notifications as notification
  where notification.recipient_profile_id = caller_profile_id
    and (
      p_before_last_activity_at is null
      or (notification.last_activity_at, notification.id)
        < (p_before_last_activity_at, p_before_id)
    )
  order by notification.last_activity_at desc, notification.id desc
  limit p_limit;
end;
$function$;

REVOKE ALL ON FUNCTION public.list_my_notifications(timestamp WITH time zone, uuid, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_my_notifications(timestamp WITH time zone, uuid, integer) TO authenticated;

CREATE FUNCTION public.mark_all_my_notifications_read()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  changed bigint;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  update public.notifications
  set read_at = now()
  where recipient_profile_id = private.current_profile_id() and read_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$function$;

REVOKE ALL ON FUNCTION public.mark_all_my_notifications_read() FROM PUBLIC;

GRANT ALL ON FUNCTION public.mark_all_my_notifications_read() TO authenticated;

CREATE FUNCTION public.mark_my_notification_read (
  p_notification_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id
    and recipient_profile_id = private.current_profile_id();
  return found;
end;
$function$;

REVOKE ALL ON FUNCTION public.mark_my_notification_read(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.mark_my_notification_read(uuid) TO authenticated;

CREATE FUNCTION public.register_my_web_push_subscription (
  p_endpoint        text,
  p_p256dh          text,
  p_auth            text,
  p_expiration_time double precision DEFAULT NULL::double precision
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
  if p_endpoint !~ '^https://[^[:space:]]+$'
    or p_p256dh !~ '^[A-Za-z0-9_-]+$'
    or p_auth !~ '^[A-Za-z0-9_-]+$'
    or p_expiration_time < 0
    or p_expiration_time > 253402300799999 then
    raise exception 'invalid web push subscription' using errcode = '22023';
  end if;
  insert into private.web_push_subscriptions as subscription (
    profile_id, endpoint, p256dh, auth, expiration_time
  ) values (
    caller_profile_id, p_endpoint, p_p256dh, p_auth,
    case when p_expiration_time is null
      then null
      else to_timestamp(p_expiration_time / 1000.0)
    end
  ) on conflict (endpoint) do update set
    profile_id = excluded.profile_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    expiration_time = excluded.expiration_time,
    updated_at = now();
end;
$function$;

REVOKE ALL ON FUNCTION public.register_my_web_push_subscription(text, text, text, double precision) FROM PUBLIC;

GRANT ALL ON FUNCTION public.register_my_web_push_subscription(text, text, text, double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_group_join_request (
  p_group_id   uuid,
  p_request_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  requested_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = p_group_id for update;

  if not exists (
    select 1
    from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
      and caller_membership.role in ('owner', 'admin')
  ) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  delete from public.group_join_requests as join_request
  where join_request.group_id = p_group_id
    and join_request.id = p_request_id
  returning join_request.profile_id into requested_profile_id;

  if not found then
    raise exception 'join request not found' using errcode = 'P0002';
  end if;

  perform private.emit_notification(
    'group-join-rejected:' || p_request_id::text,
    requested_profile_id, 'group_join_rejected', 'normal', 'group', 'staff',
    caller_profile_id, '운영진', null, '그룹 가입 요청이 거절되었습니다.', p_group_id
  );
end;
$function$;

CREATE FUNCTION public.resolve_my_notification_destination (
  p_notification_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target public.notifications;
  destination text := '/noti';
  group_slug text;
  profile_pub_id text;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select notification.* into target
  from public.notifications as notification
  where notification.id = p_notification_id
    and notification.recipient_profile_id = private.current_profile_id()
  for update;
  if target.id is null then
    raise exception 'notification not found' using errcode = 'P0002';
  end if;

  if target.post_id is not null and private.can_read_post(target.post_id) then
    if target.group_id is not null then
      select group_record.slug into group_slug
      from public.groups as group_record
      where group_record.id = target.group_id and group_record.deleted_at is null;
      if group_slug is not null then
        destination := '/groups/' || group_slug || '/posts/' || target.post_id::text;
      end if;
    else
      select profile.pub_id into profile_pub_id
      from public.posts as post
      join public.profiles as profile on profile.id = post.timeline_profile_id
      where post.id = target.post_id;
      if profile_pub_id is not null then
        destination := '/profile/' || profile_pub_id || '/posts/' || target.post_id::text;
      end if;
    end if;
  elsif target.group_id is not null and private.is_group_member(target.group_id) then
    select group_record.slug into group_slug
    from public.groups as group_record
    where group_record.id = target.group_id and group_record.deleted_at is null;
    if group_slug is not null then destination := '/groups/' || group_slug; end if;
  elsif target.target_profile_id is not null then
    select profile.pub_id into profile_pub_id
    from public.profiles as profile
    where profile.id = target.target_profile_id
      and profile.status = 'accepted' and profile.deleted_at is null;
    if profile_pub_id is not null then destination := '/profile/' || profile_pub_id; end if;
  elsif target.kind = 'gongang_preempted' then
    destination := '/util/gongang';
  end if;

  update public.notifications set read_at = coalesce(read_at, now()) where id = target.id;
  return destination;
end;
$function$;

REVOKE ALL ON FUNCTION public.resolve_my_notification_destination(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.resolve_my_notification_destination(uuid) TO authenticated;

CREATE FUNCTION public.set_my_group_notification_preferences (
  p_group_id              uuid,
  p_notification_level    public.group_notification_level,
  p_new_post_push_enabled boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_notification_level is null or p_new_post_push_enabled is null then
    raise exception 'group notification preferences must not be null' using errcode = '22023';
  end if;
  update public.group_memberships
  set notification_level = p_notification_level,
    new_post_push_enabled = p_new_post_push_enabled
  where group_id = p_group_id and profile_id = private.current_profile_id();
  if not found then
    raise exception 'group membership required' using errcode = '42501';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.set_my_group_notification_preferences(uuid, public.group_notification_level, boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_my_group_notification_preferences(uuid, public.group_notification_level, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_group_ownership (
  p_group_id             uuid,
  p_target_membership_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  owner_membership_id uuid;
  target_role public.group_member_role;
  target_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = p_group_id for update;

  select membership.id
  into owner_membership_id
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id
    and membership.role = 'owner'
  for update;

  select membership.role, membership.profile_id
  into target_role, target_profile_id
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.id = p_target_membership_id
  for update;

  if owner_membership_id is null or target_role is distinct from 'admin' then
    raise exception 'ownership can only be transferred to an administrator'
      using errcode = '42501';
  end if;

  update public.group_memberships
  set role = 'admin'
  where id = owner_membership_id;

  update public.group_memberships
  set role = 'owner'
  where id = p_target_membership_id;

  perform private.emit_notification(
    'group-ownership:' || p_group_id::text || ':' || txid_current()::text || ':new',
    target_profile_id, 'group_ownership_transferred', 'high', 'group', 'staff',
    caller_profile_id, '운영진', null, '그룹 소유권을 이전받았습니다.', p_group_id
  );
  perform private.emit_notification(
    'group-ownership:' || p_group_id::text || ':' || txid_current()::text || ':old',
    caller_profile_id, 'group_ownership_transferred', 'high', 'group', 'staff',
    target_profile_id, '운영진', null, '그룹 소유권이 이전되었습니다.', p_group_id
  );
end;
$function$;

CREATE FUNCTION public.unregister_my_web_push_subscription (
  p_endpoint text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  delete from private.web_push_subscriptions
  where endpoint = p_endpoint and profile_id = private.current_profile_id();
  return found;
end;
$function$;

REVOKE ALL ON FUNCTION public.unregister_my_web_push_subscription(text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.unregister_my_web_push_subscription(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_group_member_role (
  p_group_id      uuid,
  p_membership_id uuid,
  p_role          public.group_member_role
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  caller_role public.group_member_role;
  target_role public.group_member_role;
  target_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null or p_role = 'owner' then
    raise exception 'role change is not allowed' using errcode = '42501';
  end if;

  select membership.role
  into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id
  for update;

  select membership.role, membership.profile_id
  into target_role, target_profile_id
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.id = p_membership_id
  for update;

  if caller_role not in ('owner', 'admin') or target_role is null or target_role = 'owner' then
    raise exception 'role change is not allowed' using errcode = '42501';
  end if;

  if p_role = 'admin' and caller_role <> 'owner' then
    raise exception 'only the owner can appoint an administrator' using errcode = '42501';
  end if;

  if target_role = 'admin' and caller_role <> 'owner' then
    raise exception 'only the owner can change an administrator' using errcode = '42501';
  end if;

  update public.group_memberships
  set role = p_role
  where group_id = p_group_id
    and id = p_membership_id;

  if target_role is distinct from p_role then
    perform private.emit_notification(
      'group-role:' || p_membership_id::text || ':' || txid_current()::text,
      target_profile_id, 'group_role_changed', 'normal', 'group', 'staff',
      caller_profile_id, '운영진', null, '그룹 역할이 변경되었습니다.', p_group_id
    );
  end if;
end;
$function$;

CREATE FUNCTION public.update_my_notification_preferences (
  p_content_push_enabled  boolean,
  p_timeline_push_enabled boolean,
  p_group_push_enabled    boolean,
  p_account_push_enabled  boolean,
  p_school_push_enabled   boolean
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
  if pg_catalog.num_nonnulls(
    p_content_push_enabled, p_timeline_push_enabled, p_group_push_enabled,
    p_account_push_enabled, p_school_push_enabled
  ) <> 5 then
    raise exception 'notification preferences must not be null' using errcode = '22023';
  end if;
  insert into public.notification_preferences as preference (
    profile_id, content_push_enabled, timeline_push_enabled,
    group_push_enabled, account_push_enabled, school_push_enabled
  ) values (
    caller_profile_id, p_content_push_enabled, p_timeline_push_enabled,
    p_group_push_enabled, p_account_push_enabled, p_school_push_enabled
  ) on conflict (profile_id) do update set
    content_push_enabled = excluded.content_push_enabled,
    timeline_push_enabled = excluded.timeline_push_enabled,
    group_push_enabled = excluded.group_push_enabled,
    account_push_enabled = excluded.account_push_enabled,
    school_push_enabled = excluded.school_push_enabled,
    updated_at = now();
end;
$function$;

REVOKE ALL ON FUNCTION public.update_my_notification_preferences(boolean, boolean, boolean, boolean, boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.update_my_notification_preferences(boolean, boolean, boolean, boolean, boolean) TO authenticated;

CREATE TRIGGER comment_reactions_notify_created
  AFTER INSERT ON public.comment_reactions
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_reaction_created();

CREATE TRIGGER group_join_requests_notify_created
  AFTER INSERT ON public.group_join_requests
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_group_join_requested();

ALTER TABLE public.group_memberships
  ADD COLUMN notification_level public.group_notification_level DEFAULT 'direct'::public.group_notification_level NOT NULL;

ALTER TABLE public.group_memberships
  ADD COLUMN new_post_push_enabled boolean DEFAULT false NOT NULL;

CREATE TRIGGER group_memberships_notify_official_join
  AFTER INSERT ON public.group_memberships
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_official_group_joined();

CREATE TRIGGER group_memberships_prepare_notification_preferences
  BEFORE INSERT ON public.group_memberships
  FOR EACH ROW
  EXECUTE FUNCTION private.prepare_group_notification_preferences();

CREATE TRIGGER groups_notify_changed
  AFTER UPDATE OF join_policy, identity_policy, posting_policy, deleted_at ON public.groups
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_group_changed();

CREATE TABLE public.notification_preferences (
  profile_id            bigint                   NOT NULL,
  content_push_enabled  boolean                  DEFAULT true NOT NULL,
  timeline_push_enabled boolean                  DEFAULT true NOT NULL,
  group_push_enabled    boolean                  DEFAULT true NOT NULL,
  account_push_enabled  boolean                  DEFAULT true NOT NULL,
  school_push_enabled   boolean                  DEFAULT true NOT NULL,
  updated_at            timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.notification_preferences
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (profile_id);

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.notification_preferences TO service_role;

CREATE POLICY notification_preferences_deny_direct ON public.notification_preferences
  USING (false)
  WITH CHECK (false);

CREATE TABLE public.notifications (
  id                   uuid                               DEFAULT gen_random_uuid() NOT NULL,
  recipient_profile_id bigint                             NOT NULL,
  kind                 public.notification_kind           NOT NULL,
  importance           public.notification_importance     NOT NULL,
  category             public.notification_category       NOT NULL,
  actor_identity       public.notification_actor_identity NOT NULL,
  actor_profile_id     bigint,
  actor_display_name   text,
  actor_avatar_path    text,
  actor_count          integer                            DEFAULT 1 NOT NULL,
  group_id             uuid,
  post_id              uuid,
  comment_id           uuid,
  target_profile_id    bigint,
  reservation_id       bigint,
  title                text                               NOT NULL,
  created_at           timestamp with time zone           DEFAULT now() NOT NULL,
  last_activity_at     timestamp with time zone           DEFAULT now() NOT NULL,
  read_at              timestamp with time zone
);

CREATE FUNCTION private.notification_push_allowed (
  p_notification                 public.notifications,
  p_subscription_created_at      timestamp with time zone,
  p_subscription_expiration_time timestamp with time zone
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select p_subscription_created_at <= p_notification.created_at
    and (
      p_subscription_expiration_time is null
      or p_subscription_expiration_time > now()
    )
    and p_notification.kind not in ('post_reacted', 'comment_reacted', 'application_submitted')
    and (
      p_notification.category = 'moderation'
      or case p_notification.category
        when 'content' then coalesce(preference.content_push_enabled, true)
        when 'timeline' then coalesce(preference.timeline_push_enabled, true)
        when 'group' then coalesce(preference.group_push_enabled, true)
        when 'account' then coalesce(preference.account_push_enabled, true)
        when 'school' then coalesce(preference.school_push_enabled, true)
        when 'moderation' then true
      end
    )
    and (
      p_notification.group_id is null
      or p_notification.category <> 'content'
      or exists (
        select 1
        from public.group_memberships as membership
        where membership.group_id = p_notification.group_id
          and membership.profile_id = p_notification.recipient_profile_id
          and membership.notification_level <> 'none'
      )
    )
    and (
      p_notification.kind <> 'group_posted'
      or exists (
        select 1
        from public.group_memberships as membership
        where membership.group_id = p_notification.group_id
          and membership.profile_id = p_notification.recipient_profile_id
          and membership.notification_level = 'all'
          and membership.new_post_push_enabled
      )
    )
  from (select 1) as singleton
  left join public.notification_preferences as preference
    on preference.profile_id = p_notification.recipient_profile_id;
$function$;

REVOKE ALL ON FUNCTION private.notification_push_allowed(public.notifications, timestamp WITH time zone, timestamp WITH time zone) FROM PUBLIC;

ALTER TABLE public.notifications
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_activity_order CHECK (last_activity_at >= created_at AND (read_at IS NULL OR read_at >= created_at));

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_actor_count_positive CHECK (actor_count >= 1);

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_actor_profile_id_fkey FOREIGN KEY (actor_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_actor_shape CHECK (actor_identity = 'identified'::public.notification_actor_identity AND actor_profile_id IS
    NOT NULL OR actor_identity <> 'identified'::public.notification_actor_identity AND actor_profile_id IS NULL);

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.post_comments(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE private.notification_delivery_outbox
  ADD CONSTRAINT notification_delivery_outbox_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;

ALTER TABLE private.notification_event_keys
  ADD CONSTRAINT notification_event_keys_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_recipient_profile_id_fkey FOREIGN KEY (recipient_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.utility_reservations(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_target_profile_id_fkey FOREIGN KEY (target_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_title_length CHECK (char_length(btrim(title)) >= 1 AND char_length(btrim(title)) <= 160);

GRANT SELECT ON public.notifications TO authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.notifications TO service_role;

CREATE INDEX notifications_recent_unread_idx ON public.notifications (recipient_profile_id, last_activity_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX notifications_recipient_page_idx ON public.notifications (recipient_profile_id, last_activity_at DESC, id DESC);

CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT
  TO authenticated
  USING ((recipient_profile_id = private.current_profile_id()));

CREATE TRIGGER post_comments_notify_created
  AFTER INSERT ON public.post_comments
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_comment_created();

CREATE TRIGGER post_reactions_notify_created
  AFTER INSERT ON public.post_reactions
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_reaction_created();

CREATE TRIGGER posts_notify_published
  AFTER INSERT OR UPDATE OF published_at ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_post_published();

CREATE TRIGGER profile_permissions_notify_changed
  AFTER INSERT OR DELETE ON public.profile_permissions
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_profile_permission_changed();

CREATE TRIGGER profiles_notify_changed
  AFTER UPDATE OF status, ROLE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_profile_changed();

-- Declarative diff does not capture data backfills, publications, or cron jobs.
UPDATE public.group_memberships AS membership
SET notification_level = 'all'::public.group_notification_level
FROM public.groups AS group_record
WHERE group_record.id = membership.group_id
  AND group_record.kind = 'official';

REVOKE ALL ON TABLE private.web_push_subscriptions FROM anon, authenticated;
REVOKE ALL ON TABLE private.notification_event_keys FROM anon, authenticated;
REVOKE ALL ON TABLE private.notification_delivery_outbox FROM anon, authenticated;
REVOKE ALL ON TABLE private.notification_delivery_attempts FROM anon, authenticated;
REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.notifications, public.notification_preferences
  FROM anon, authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

SELECT cron.schedule(
  'dispatch-notifications-every-30-seconds',
  '*/30 * * * * *',
  'select private.invoke_notification_dispatcher()'
);

SELECT cron.schedule(
  'cleanup-notifications-daily',
  '23 4 * * *',
  'select private.cleanup_expired_notifications()'
);
