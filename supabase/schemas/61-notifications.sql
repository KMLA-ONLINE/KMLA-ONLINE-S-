-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.

create type public.notification_importance as enum ('low', 'normal', 'high');
alter type public.notification_importance owner to postgres;

create type public.notification_category as enum (
  'content', 'timeline', 'group', 'account', 'school', 'moderation'
);
alter type public.notification_category owner to postgres;

create type public.notification_actor_identity as enum (
  'identified', 'anonymous', 'staff', 'system'
);
alter type public.notification_actor_identity owner to postgres;

create type public.notification_kind as enum (
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
  'anonymous_activity_restricted',
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
alter type public.notification_kind owner to postgres;

create type public.group_notification_level as enum ('none', 'direct', 'all');
alter type public.group_notification_level owner to postgres;

create type private.notification_delivery_channel as enum ('web_push', 'email');
alter type private.notification_delivery_channel owner to postgres;

create type private.notification_delivery_status as enum (
  'pending', 'leased', 'sent', 'suppressed', 'dead'
);
alter type private.notification_delivery_status owner to postgres;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id bigint not null references public.profiles(id) on delete cascade,
  kind public.notification_kind not null,
  importance public.notification_importance not null,
  category public.notification_category not null,
  actor_identity public.notification_actor_identity not null,
  actor_profile_id bigint references public.profiles(id) on delete set null,
  actor_display_name text,
  actor_avatar_path text,
  actor_count integer not null default 1,
  group_id uuid references public.groups(id) on delete set null,
  post_id uuid references public.posts(id) on delete set null,
  comment_id uuid references public.post_comments(id) on delete set null,
  target_profile_id bigint references public.profiles(id) on delete set null,
  reservation_id bigint references public.utility_reservations(id) on delete set null,
  title text not null,
  detail text,
  restriction_expires_at timestamptz,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_actor_count_positive check (actor_count >= 1),
  constraint notifications_actor_shape check (
    (actor_identity = 'identified' and actor_profile_id is not null)
    or (actor_identity <> 'identified' and actor_profile_id is null)
  ),
  constraint notifications_title_length check (
    char_length(btrim(title)) between 1 and 160
  ),
  constraint notifications_detail_length check (
    detail is null or (detail = btrim(detail) and char_length(detail) >= 1 and char_length(detail) <= 300)
  ),
  constraint notifications_restriction_shape check (
    restriction_expires_at is null or kind = 'anonymous_activity_restricted'
  ),
  constraint notifications_activity_order check (
    last_activity_at >= created_at and (read_at is null or read_at >= created_at)
  )
);
alter table public.notifications owner to postgres;

create index notifications_recipient_page_idx
on public.notifications (recipient_profile_id, last_activity_at desc, id desc);
create index notifications_recent_unread_idx
on public.notifications (recipient_profile_id, last_activity_at desc)
where read_at is null;

create table public.notification_preferences (
  profile_id bigint primary key references public.profiles(id) on delete cascade,
  content_push_enabled boolean not null default true,
  timeline_push_enabled boolean not null default true,
  group_push_enabled boolean not null default true,
  account_push_enabled boolean not null default true,
  school_push_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences owner to postgres;

alter table public.group_memberships
  add column notification_level public.group_notification_level not null default 'direct',
  add column content_push_enabled boolean not null default true,
  add column new_post_push_enabled boolean not null default false,
  add constraint group_memberships_content_push_requires_in_app
    check (not content_push_enabled or notification_level <> 'none'),
  add constraint group_memberships_new_post_push_requires_all
    check (not new_post_push_enabled or notification_level = 'all');

create table private.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id bigint not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time timestamptz,
  foreground_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint web_push_subscriptions_endpoint_length check (
    char_length(endpoint) between 12 and 2048
  ),
  constraint web_push_subscriptions_key_length check (
    char_length(p256dh) >= 20 and char_length(p256dh) <= 256
      and char_length(auth) >= 8 and char_length(auth) <= 128
  )
);
alter table private.web_push_subscriptions owner to postgres;
create index web_push_subscriptions_profile_idx
on private.web_push_subscriptions (profile_id, created_at);

create table private.notification_event_keys (
  event_key text primary key,
  notification_id uuid references public.notifications(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint notification_event_keys_length check (char_length(event_key) between 3 and 300)
);
alter table private.notification_event_keys owner to postgres;
create index notification_event_keys_notification_idx
on private.notification_event_keys (notification_id);

create table private.notification_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete cascade,
  recipient_profile_id bigint not null references public.profiles(id) on delete cascade,
  subscription_id uuid references private.web_push_subscriptions(id) on delete cascade,
  channel private.notification_delivery_channel not null,
  status private.notification_delivery_status not null default 'pending',
  recipient_email text,
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  lease_id uuid,
  lease_expires_at timestamptz,
  last_status_code integer,
  last_error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint notification_delivery_outbox_attempts check (attempt_count between 0 and 10),
  constraint notification_delivery_outbox_channel_shape check (
    (channel = 'web_push' and subscription_id is not null and recipient_email is null)
    or (channel = 'email' and subscription_id is null and recipient_email is not null)
  ),
  constraint notification_delivery_outbox_lease_shape check (
    (status = 'leased' and lease_id is not null and lease_expires_at is not null)
    or (status <> 'leased' and lease_id is null and lease_expires_at is null)
  ),
  constraint notification_delivery_outbox_completion_shape check (
    (status in ('sent', 'suppressed', 'dead')) = (completed_at is not null)
  )
);
alter table private.notification_delivery_outbox owner to postgres;
create unique index notification_delivery_push_unique_idx
on private.notification_delivery_outbox (notification_id, subscription_id, channel)
where channel = 'web_push';
create unique index notification_delivery_email_unique_idx
on private.notification_delivery_outbox (notification_id, channel)
where channel = 'email';
create index notification_delivery_claim_idx
on private.notification_delivery_outbox (available_at, created_at, id)
where status in ('pending', 'leased');

create table private.notification_delivery_attempts (
  id bigint generated always as identity primary key,
  delivery_id uuid not null references private.notification_delivery_outbox(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  outcome text not null,
  status_code integer,
  error_code text,
  constraint notification_delivery_attempts_outcome check (
    outcome in ('sent', 'suppressed', 'retry', 'dead', 'gone')
  )
);
alter table private.notification_delivery_attempts owner to postgres;

create or replace function private.notification_push_allowed(
  p_notification public.notifications,
  p_subscription_created_at timestamptz,
  p_subscription_expiration_time timestamptz
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_subscription_created_at <= p_notification.created_at
    and (
      p_subscription_expiration_time is null
      or p_subscription_expiration_time > now()
    )
    and p_notification.kind not in ('post_reacted', 'comment_reacted', 'application_submitted')
    and (
      p_notification.category = 'moderation'
      or p_notification.kind = 'group_posted'
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
          and membership.content_push_enabled
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
$$;
alter function private.notification_push_allowed(public.notifications, timestamptz, timestamptz) owner to postgres;

create or replace function private.notification_delivery_allowed(
  p_delivery private.notification_delivery_outbox
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_delivery.channel = 'email'
    or exists (
      select 1
      from public.notifications as notification
      join private.web_push_subscriptions as subscription
        on subscription.id = p_delivery.subscription_id
      where notification.id = p_delivery.notification_id
        and subscription.profile_id = p_delivery.recipient_profile_id
        and private.notification_push_allowed(
          notification, subscription.created_at, subscription.expiration_time
        )
        and (
          notification.importance = 'high'
          or subscription.foreground_until is null
          or subscription.foreground_until <= now()
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
                and post.deleted_at is null
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
                and group_record.deleted_at is null
            )
          )
          or (notification.post_id is null and notification.group_id is null)
        )
    );
$$;
alter function private.notification_delivery_allowed(private.notification_delivery_outbox) owner to postgres;

create or replace function private.enqueue_notification_push(
  p_notification_id uuid
) returns integer
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function private.enqueue_notification_push(uuid) owner to postgres;

create or replace function private.enqueue_notification_email(
  p_notification_id uuid,
  p_recipient_email text
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function private.enqueue_notification_email(uuid, text) owner to postgres;

create or replace function private.emit_notification(
  p_event_key text,
  p_recipient_profile_id bigint,
  p_kind public.notification_kind,
  p_importance public.notification_importance,
  p_category public.notification_category,
  p_actor_identity public.notification_actor_identity,
  p_actor_profile_id bigint,
  p_actor_display_name text,
  p_actor_avatar_path text,
  p_title text,
  p_group_id uuid default null,
  p_post_id uuid default null,
  p_comment_id uuid default null,
  p_target_profile_id bigint default null,
  p_reservation_id bigint default null,
  p_aggregate_key text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function private.emit_notification(
  text, bigint, public.notification_kind, public.notification_importance,
  public.notification_category, public.notification_actor_identity, bigint,
  text, text, text, uuid, uuid, uuid, bigint, bigint, text
) owner to postgres;

create or replace function public.list_my_notifications(
  p_before_last_activity_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
) returns table (
  id uuid,
  kind public.notification_kind,
  importance public.notification_importance,
  category public.notification_category,
  actor_identity public.notification_actor_identity,
  actor_display_name text,
  actor_avatar_path text,
  actor_count integer,
  group_id uuid,
  group_name text,
  post_id uuid,
  comment_id uuid,
  target_profile_id bigint,
  reservation_id bigint,
  title text,
  detail text,
  restriction_expires_at timestamptz,
  created_at timestamptz,
  last_activity_at timestamptz,
  read_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
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

  -- 알림함 한 행은 "어디서 온 소식인가"를 말해야 한다. 특히 그룹 새 게시물 알림의 제목은
  -- 게시물 제목 그대로라서, 그룹 이름이 없으면 어느 그룹 글인지 알 방법이 없다.
  -- 이미 recipient 본인의 알림만 돌려주고 그 행이 group_id를 들고 있으므로 이름을 함께
  -- 내보내도 새로 드러나는 정보는 없다.
  --
  -- 그룹 삭제는 deleted_at을 세우는 soft delete라서 삭제된 그룹의 알림도 이름을 그대로
  -- 들고 온다. 그래야 "그룹이 영구 삭제되었습니다"가 어느 그룹인지 말할 수 있다. 이름이
  -- 비는 경우는 애초에 그룹과 무관한 알림뿐이다.
  return query
  select notification.id, notification.kind, notification.importance,
    notification.category, notification.actor_identity,
    notification.actor_display_name, notification.actor_avatar_path,
    notification.actor_count, notification.group_id, notification_group.name,
    notification.post_id,
    notification.comment_id, notification.target_profile_id,
    notification.reservation_id,
    notification.title, notification.detail, notification.restriction_expires_at,
    notification.created_at, notification.last_activity_at,
    notification.read_at
  from public.notifications as notification
  left join public.groups as notification_group
    on notification_group.id = notification.group_id
  where notification.recipient_profile_id = caller_profile_id
    and (
      p_before_last_activity_at is null
      or (notification.last_activity_at, notification.id)
        < (p_before_last_activity_at, p_before_id)
    )
  order by notification.last_activity_at desc, notification.id desc
  limit p_limit;
end;
$$;
alter function public.list_my_notifications(timestamptz, uuid, integer) owner to postgres;

create or replace function public.mark_my_notification_read(p_notification_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function public.mark_my_notification_read(uuid) owner to postgres;

create or replace function public.mark_all_my_notifications_read()
returns bigint
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function public.mark_all_my_notifications_read() owner to postgres;

create or replace function public.get_my_recent_unread_notification_count()
returns bigint
language plpgsql stable security definer
set search_path = ''
as $$
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
$$;
alter function public.get_my_recent_unread_notification_count() owner to postgres;

create or replace function public.get_my_notification_preferences()
returns table (
  content_push_enabled boolean,
  timeline_push_enabled boolean,
  group_push_enabled boolean,
  account_push_enabled boolean,
  school_push_enabled boolean
)
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function public.get_my_notification_preferences() owner to postgres;

create or replace function public.update_my_notification_preferences(
  p_content_push_enabled boolean,
  p_timeline_push_enabled boolean,
  p_group_push_enabled boolean,
  p_account_push_enabled boolean,
  p_school_push_enabled boolean
) returns void
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function public.update_my_notification_preferences(boolean, boolean, boolean, boolean, boolean) owner to postgres;

create or replace function public.set_my_group_notification_preferences(
  p_group_id uuid,
  p_notification_level public.group_notification_level,
  p_content_push_enabled boolean,
  p_new_post_push_enabled boolean
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_notification_level is null
    or p_content_push_enabled is null
    or p_new_post_push_enabled is null then
    raise exception 'group notification preferences must not be null' using errcode = '22023';
  end if;
  update public.group_memberships
  set notification_level = p_notification_level,
    content_push_enabled = p_notification_level <> 'none' and p_content_push_enabled,
    new_post_push_enabled = p_notification_level = 'all' and p_new_post_push_enabled
  where group_id = p_group_id and profile_id = private.current_profile_id();
  if not found then
    raise exception 'group membership required' using errcode = '42501';
  end if;
end;
$$;
alter function public.set_my_group_notification_preferences(uuid, public.group_notification_level, boolean, boolean) owner to postgres;

create or replace function public.register_my_web_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_expiration_time double precision default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function public.register_my_web_push_subscription(text, text, text, double precision) owner to postgres;

create or replace function public.unregister_my_web_push_subscription(p_endpoint text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  delete from private.web_push_subscriptions
  where endpoint = p_endpoint and profile_id = private.current_profile_id();
  return found;
end;
$$;
alter function public.unregister_my_web_push_subscription(text) owner to postgres;

create or replace function public.get_my_web_push_status(p_endpoint text)
returns table (subscribed boolean)
language plpgsql stable security definer
set search_path = ''
as $$
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
$$;
alter function public.get_my_web_push_status(text) owner to postgres;

create or replace function public.refresh_my_web_push_foreground(p_endpoint text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  update private.web_push_subscriptions
  set foreground_until = now() + interval '40 seconds'
  where endpoint = p_endpoint and profile_id = private.current_profile_id();
  return found;
end;
$$;
alter function public.refresh_my_web_push_foreground(text) owner to postgres;

create or replace function public.resolve_my_notification_destination(p_notification_id uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function public.resolve_my_notification_destination(uuid) owner to postgres;

create or replace function public.claim_notification_deliveries(
  p_limit integer default 50,
  p_lease_seconds integer default 120
) returns table (
  delivery_id uuid,
  lease_id uuid,
  channel private.notification_delivery_channel,
  endpoint text,
  p256dh text,
  auth text,
  recipient_email text,
  notification_id uuid,
  importance public.notification_importance,
  category public.notification_category,
  title text,
  body text,
  tag text
)
language plpgsql security definer
set search_path = ''
as $$
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
  )
  select claimed.id, claimed.lease_id, claimed.channel,
    subscription.endpoint, subscription.p256dh, subscription.auth,
    claimed.recipient_email, notification.id,
    notification.importance, notification.category,
    notification.title,
    case notification.kind
      when 'post_commented' then '내 게시물에 새 댓글이 등록되었습니다.'
      when 'comment_replied' then '내 댓글에 새 답글이 등록되었습니다.'
      when 'group_posted' then '그룹에 새 게시물이 등록되었습니다.'
      when 'account_approved' then '가입이 승인되었습니다.'
      when 'account_blocked' then '가입이 차단되었습니다.'
      when 'account_unblocked' then '차단이 해제되었습니다.'
      when 'anonymous_activity_restricted' then '그룹 익명 활동이 제한되었습니다.'
      else '새 알림이 있습니다.'
    end,
    case
      when notification.importance = 'high'
        then 'notification:' || notification.id::text
      else 'notification-category:' || notification.category::text
    end
  from claimed
  left join private.web_push_subscriptions as subscription
    on subscription.id = claimed.subscription_id
  left join public.notifications as notification
    on notification.id = claimed.notification_id;
end;
$$;
alter function public.claim_notification_deliveries(integer, integer) owner to postgres;

create or replace function public.prepare_notification_delivery(
  p_delivery_id uuid,
  p_lease_id uuid
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  target private.notification_delivery_outbox;
begin
  select delivery.* into target
  from private.notification_delivery_outbox as delivery
  where delivery.id = p_delivery_id
    and delivery.status = 'leased'
    and delivery.lease_id = p_lease_id
    and delivery.lease_expires_at > now()
  for update;

  if target.id is null then return false; end if;
  if private.notification_delivery_allowed(target) then return true; end if;

  update private.notification_delivery_outbox
  set status = 'suppressed', completed_at = now(),
    lease_id = null, lease_expires_at = null,
    last_error_code = 'no_longer_deliverable'
  where id = target.id;

  insert into private.notification_delivery_attempts (
    delivery_id, outcome, error_code
  ) values (target.id, 'suppressed', 'no_longer_deliverable');

  return false;
end;
$$;
alter function public.prepare_notification_delivery(uuid, uuid) owner to postgres;

create or replace function public.complete_notification_delivery(
  p_delivery_id uuid,
  p_lease_id uuid,
  p_outcome text,
  p_status_code integer default null,
  p_error_code text default null
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  target private.notification_delivery_outbox;
begin
  if p_outcome not in ('sent', 'suppressed', 'retry', 'dead', 'gone') then
    raise exception 'invalid notification delivery outcome' using errcode = '22023';
  end if;
  select delivery.* into target
  from private.notification_delivery_outbox as delivery
  where delivery.id = p_delivery_id and delivery.status = 'leased'
    and delivery.lease_id = p_lease_id
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
$$;
alter function public.complete_notification_delivery(uuid, uuid, text, integer, text) owner to postgres;

create or replace function private.cleanup_expired_notifications()
returns bigint
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function private.cleanup_expired_notifications() owner to postgres;

create or replace function private.invoke_notification_dispatcher()
returns bigint
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function private.invoke_notification_dispatcher() owner to postgres;

create or replace function private.prepare_group_notification_preferences()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.groups as group_record
    where group_record.id = new.group_id and group_record.kind = 'official'
  ) then
    new.notification_level := 'all';
  end if;
  return new;
end;
$$;
alter function private.prepare_group_notification_preferences() owner to postgres;

create or replace function private.notify_comment_created()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function private.notify_comment_created() owner to postgres;

create or replace function private.notify_reaction_created()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function private.notify_reaction_created() owner to postgres;

create or replace function private.notify_post_published()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function private.notify_post_published() owner to postgres;

create or replace function private.notify_group_join_requested()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function private.notify_group_join_requested() owner to postgres;

create or replace function private.cleanup_group_join_request_notification()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.notifications as notification
  where notification.id in (
    select event_key.notification_id
    from private.notification_event_keys as event_key
    where event_key.event_key like
      'group-join-request:' || old.id::text || ':recipient:%'
  );
  return old;
end;
$$;
alter function private.cleanup_group_join_request_notification() owner to postgres;

create or replace function private.notify_official_group_joined()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function private.notify_official_group_joined() owner to postgres;

create or replace function private.notify_group_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function private.notify_group_changed() owner to postgres;

create or replace function private.notify_profile_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function private.notify_profile_changed() owner to postgres;

create or replace function private.notify_profile_permission_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
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
$$;
alter function private.notify_profile_permission_changed() owner to postgres;

create or replace function private.notify_group_anonymous_activity_restricted()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  notification_id uuid;
begin
  notification_id := private.emit_notification(
    'anonymous-activity-restricted:' || new.id::text,
    new.profile_id, 'anonymous_activity_restricted', 'high', 'moderation',
    'staff', new.restricted_by_profile_id, '운영진', null,
    '그룹 익명 활동이 제한되었습니다.', new.group_id
  );
  update public.notifications
  set detail = new.reason, restriction_expires_at = new.expires_at
  where id = notification_id;
  return new;
end;
$$;
alter function private.notify_group_anonymous_activity_restricted() owner to postgres;

create trigger group_memberships_prepare_notification_preferences
before insert on public.group_memberships
for each row execute function private.prepare_group_notification_preferences();
create trigger post_comments_notify_created
after insert on public.post_comments
for each row execute function private.notify_comment_created();
create trigger post_reactions_notify_created
after insert on public.post_reactions
for each row execute function private.notify_reaction_created();
create trigger comment_reactions_notify_created
after insert on public.comment_reactions
for each row execute function private.notify_reaction_created();
create trigger posts_notify_published
after insert or update of published_at on public.posts
for each row execute function private.notify_post_published();
create trigger group_join_requests_notify_created
after insert on public.group_join_requests
for each row execute function private.notify_group_join_requested();
create trigger group_join_requests_cleanup_notification
after delete on public.group_join_requests
for each row execute function private.cleanup_group_join_request_notification();
create trigger group_memberships_notify_official_join
after insert on public.group_memberships
for each row execute function private.notify_official_group_joined();
create trigger groups_notify_changed
after update of join_policy, identity_policy, posting_policy, deleted_at on public.groups
for each row execute function private.notify_group_changed();
create trigger profiles_notify_changed
after update of status, role on public.profiles
for each row execute function private.notify_profile_changed();
create trigger profile_permissions_notify_changed
after insert or delete on public.profile_permissions
for each row execute function private.notify_profile_permission_changed();
create trigger group_anonymous_activity_restrictions_notify_created
after insert on private.group_anonymous_activity_restrictions
for each row execute function private.notify_group_anonymous_activity_restricted();

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications
for select to authenticated
using (recipient_profile_id = private.current_profile_id());

alter table public.notification_preferences enable row level security;
create policy notification_preferences_deny_direct on public.notification_preferences
using (false) with check (false);

alter table private.web_push_subscriptions enable row level security;
create policy web_push_subscriptions_deny_client on private.web_push_subscriptions
using (false) with check (false);
alter table private.notification_event_keys enable row level security;
create policy notification_event_keys_deny_client on private.notification_event_keys
using (false) with check (false);
alter table private.notification_delivery_outbox enable row level security;
create policy notification_delivery_outbox_deny_client on private.notification_delivery_outbox
using (false) with check (false);
alter table private.notification_delivery_attempts enable row level security;
create policy notification_delivery_attempts_deny_client on private.notification_delivery_attempts
using (false) with check (false);

revoke all on function private.notification_push_allowed(public.notifications, timestamptz, timestamptz) from public;
revoke all on function private.notification_delivery_allowed(private.notification_delivery_outbox) from public;
revoke all on function private.enqueue_notification_push(uuid) from public;
revoke all on function private.enqueue_notification_email(uuid, text) from public;
revoke all on function private.emit_notification(
  text, bigint, public.notification_kind, public.notification_importance,
  public.notification_category, public.notification_actor_identity, bigint,
  text, text, text, uuid, uuid, uuid, bigint, bigint, text
) from public;
revoke all on function private.cleanup_expired_notifications() from public;
revoke all on function private.invoke_notification_dispatcher() from public;
revoke all on function private.prepare_group_notification_preferences() from public;
revoke all on function private.notify_comment_created() from public;
revoke all on function private.notify_reaction_created() from public;
revoke all on function private.notify_post_published() from public;
revoke all on function private.notify_group_join_requested() from public;
revoke all on function private.cleanup_group_join_request_notification() from public;
revoke all on function private.notify_official_group_joined() from public;
revoke all on function private.notify_group_changed() from public;
revoke all on function private.notify_profile_changed() from public;
revoke all on function private.notify_profile_permission_changed() from public;
revoke all on function private.notify_group_anonymous_activity_restricted() from public;

revoke all on function public.list_my_notifications(timestamptz, uuid, integer) from public;
grant execute on function public.list_my_notifications(timestamptz, uuid, integer) to authenticated;
revoke all on function public.mark_my_notification_read(uuid) from public;
grant execute on function public.mark_my_notification_read(uuid) to authenticated;
revoke all on function public.mark_all_my_notifications_read() from public;
grant execute on function public.mark_all_my_notifications_read() to authenticated;
revoke all on function public.get_my_recent_unread_notification_count() from public;
grant execute on function public.get_my_recent_unread_notification_count() to authenticated;
revoke all on function public.get_my_notification_preferences() from public;
grant execute on function public.get_my_notification_preferences() to authenticated;
revoke all on function public.update_my_notification_preferences(boolean, boolean, boolean, boolean, boolean) from public;
grant execute on function public.update_my_notification_preferences(boolean, boolean, boolean, boolean, boolean) to authenticated;
revoke all on function public.set_my_group_notification_preferences(uuid, public.group_notification_level, boolean, boolean) from public;
grant execute on function public.set_my_group_notification_preferences(uuid, public.group_notification_level, boolean, boolean) to authenticated;
revoke all on function public.register_my_web_push_subscription(text, text, text, double precision) from public;
grant execute on function public.register_my_web_push_subscription(text, text, text, double precision) to authenticated;
revoke all on function public.unregister_my_web_push_subscription(text) from public;
grant execute on function public.unregister_my_web_push_subscription(text) to authenticated;
revoke all on function public.get_my_web_push_status(text) from public;
grant execute on function public.get_my_web_push_status(text) to authenticated;
revoke all on function public.refresh_my_web_push_foreground(text) from public;
grant execute on function public.refresh_my_web_push_foreground(text) to authenticated;
revoke all on function public.resolve_my_notification_destination(uuid) from public;
grant execute on function public.resolve_my_notification_destination(uuid) to authenticated;
revoke all on function public.claim_notification_deliveries(integer, integer) from public;
grant execute on function public.claim_notification_deliveries(integer, integer) to service_role;
revoke all on function public.prepare_notification_delivery(uuid, uuid) from public;
grant execute on function public.prepare_notification_delivery(uuid, uuid) to service_role;
revoke all on function public.complete_notification_delivery(uuid, uuid, text, integer, text) from public;
grant execute on function public.complete_notification_delivery(uuid, uuid, text, integer, text) to service_role;

revoke maintain, references, trigger, truncate
on table public.notifications from anon, authenticated;
revoke all on table public.notifications from anon, authenticated;
grant select on table public.notifications to authenticated;
revoke maintain, references, trigger, truncate
on table public.notification_preferences from anon, authenticated;
revoke all on table public.notification_preferences from anon, authenticated;
revoke all on table private.web_push_subscriptions from anon, authenticated;
revoke all on table private.notification_event_keys from anon, authenticated;
revoke all on table private.notification_delivery_outbox from anon, authenticated;
revoke all on table private.notification_delivery_attempts from anon, authenticated;

grant references, trigger, truncate, maintain on table public.notifications to service_role;
grant references, trigger, truncate, maintain on table public.notification_preferences to service_role;

alter publication supabase_realtime add table public.notifications;
