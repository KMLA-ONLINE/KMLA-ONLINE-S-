SET local check_function_bodies = off;

DROP POLICY "profiles_select_accepted" ON "public"."profiles";

ALTER TABLE "private"."notification_delivery_outbox"
  DROP CONSTRAINT "notification_delivery_outbox_source";

DROP FUNCTION "public"."admin_list_roster"();

CREATE TABLE "private"."profile_suspensions" (
  "id"                      bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "profile_id"              bigint                   NOT NULL,
  "reason"                  text                     NOT NULL,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"              timestamp with time zone,
  "suspended_by_profile_id" bigint,
  "ended_at"                timestamp with time zone,
  "cancelled_at"            timestamp with time zone,
  "cancelled_by_profile_id" bigint,
  CONSTRAINT "profile_suspensions_duration" CHECK (((expires_at IS NULL) OR ((expires_at > created_at) AND (expires_at <= (created_at + '180 days'::interval))))),
  CONSTRAINT "profile_suspensions_end_shape"
    CHECK
    ((((ended_at IS NULL) AND (cancelled_at IS NULL) AND (cancelled_by_profile_id IS NULL)) OR ((ended_at = expires_at) AND (cancelled_at IS NULL) AND (cancelled_by_profile_id IS
    NULL)) OR ((ended_at = cancelled_at) AND (cancelled_at IS NOT NULL)))),
  CONSTRAINT "profile_suspensions_pkey" PRIMARY KEY (id),
  CONSTRAINT "profile_suspensions_reason" CHECK (((reason = btrim(reason)) AND (char_length(reason) >= 5) AND (char_length(reason) <= 300)))
);

ALTER TABLE "private"."profile_suspensions"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "private"."notification_delivery_outbox"
  ADD COLUMN "suspension_id" bigint;

ALTER TABLE "private"."notification_delivery_outbox"
  ADD COLUMN "suspension_event" text;

CREATE OR REPLACE FUNCTION private.can_read_group_media (
  p_object_path text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.groups as group_record
      join public.profiles as profile
        on profile.auth_user_id = auth.uid()
        and profile.status = 'accepted'
        and profile.deleted_at is null
        and not private.profile_suspended(profile.id)
      where p_object_path in (group_record.icon_path, group_record.cover_path)
        and (
          (
            profile.type in ('student', 'alumni')
            and (
              group_record.kind = 'official'
              or (
                group_record.kind = 'unofficial'
                and group_record.join_policy = 'open'
              )
            )
          )
          or (
            group_record.kind = 'unofficial'
            and private.is_group_member(group_record.id)
          )
        )
    );
$function$;

CREATE OR REPLACE FUNCTION private.can_read_profile_media_path (
  p_object_path text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.profiles as viewer
    where viewer.auth_user_id = auth.uid()
      and viewer.status = 'accepted'
      and viewer.deleted_at is null
      and not private.profile_suspended(viewer.id)
  )
  and (
    exists (
      select 1
      from public.profiles as target
      where target.status = 'accepted'
        and target.deleted_at is null
        and p_object_path in (target.avatar_path, target.cover_path)
    )
    or exists (
      select 1
      from public.posts as post
      join public.profiles as timeline
        on timeline.id = post.timeline_profile_id
        and timeline.status = 'accepted'
        and timeline.deleted_at is null
      where post.activity_media_path = p_object_path
        and post.published_at is not null
        and private.can_read_post(post.id)
    )
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_read_story (
  p_story_id bigint
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.stories as story
    join public.profiles as author
      on author.id = story.profile_id
      and author.status = 'accepted'
      and author.deleted_at is null
    join public.profiles as viewer
      on viewer.auth_user_id = auth.uid()
      and viewer.status = 'accepted'
      and viewer.deleted_at is null
      and not private.profile_suspended(viewer.id)
    where story.id = p_story_id
      and story.status = 'ready'
      and story.expires_at > now()
      and (
        author.type = 'teacher'
        or (author.type = 'student' and viewer.type in ('student', 'teacher'))
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_upload_profile_media (
  p_object_path text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.profile_media_objects as media
    join public.profiles as profile on profile.id = media.profile_id
    where media.object_path = p_object_path
      and media.status = 'pending'
      and profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and not private.profile_suspended(profile.id)
  ) or exists (
    select 1
    from public.profile_media_activity_objects as activity
    join public.profiles as profile on profile.id = activity.profile_id
    where activity.object_path = p_object_path
      and activity.status = 'pending'
      and profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and not private.profile_suspended(profile.id)
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_upload_story_media (
  p_object_path text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.stories as story
    join public.profiles as profile on profile.id = story.profile_id
    where p_object_path in (story.image_path, story.thumbnail_path)
      and story.status = 'pending'
      and profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and not private.profile_suspended(profile.id)
  );
$function$;

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
  -- 이용 정지 메일 행도 알림 행이 없어 cascade로 지워지지 않는다. 받는 주소를 오래 남기지 않는다.
  delete from private.notification_delivery_outbox
  where (message_id is not null or suspension_id is not null)
    and completed_at < now() - interval '30 days';
  return removed;
end;
$function$;

CREATE OR REPLACE FUNCTION private.current_profile_id()
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select profile.id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id);
$function$;

CREATE OR REPLACE FUNCTION private.emit_notification (
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

  -- 정지 기간에 생긴 알림은 만들지 않고 해제 뒤에도 보내지 않는다(§14.12). event key는 남겨, 멘션을
  -- 고쳐 다시 넣는 것처럼 같은 사건이 해제 뒤 다시 들어와도 새 알림이 되지 않게 한다.
  if private.profile_suspended(p_recipient_profile_id) then
    return null;
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
    and not private.profile_suspended(member.profile_id)
  on conflict do nothing;

  if found then
    perform private.wake_notification_dispatcher();
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_suspension_email (
  p_suspension_id bigint,
  p_event         text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  insert into private.notification_delivery_outbox (
    recipient_profile_id, channel, recipient_email, suspension_id, suspension_event
  )
  select suspension.profile_id, 'email', btrim(user_record.email), suspension.id, p_event
  from private.profile_suspensions as suspension
  join public.profiles as profile on profile.id = suspension.profile_id
  join auth.users as user_record on user_record.id = profile.auth_user_id
  where suspension.id = p_suspension_id
    and nullif(btrim(user_record.email), '') is not null
  on conflict do nothing;
  return found;
end;
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

CREATE OR REPLACE FUNCTION private.profile_suspended (
  p_profile_id bigint
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from private.profile_suspensions as suspension
    where suspension.profile_id = p_profile_id
      and suspension.ended_at is null
      and (suspension.expires_at is null or suspension.expires_at > now())
  );
$function$;

CREATE OR REPLACE FUNCTION private.require_app_admin()
  RETURNS bigint
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
begin
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.role = 'admin'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id);

  if caller_profile_id is null then
    raise exception 'app administrator required' using errcode = '42501';
  end if;

  return caller_profile_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.story_writer_profile_id()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  active_count integer;
begin
  -- 쓰기는 재학생과 교사만 한다. 졸업생은 읽기만 하며, 그중에서도 교사 스토리만 본다
  -- (기능 명세 §17.6). 프로필 행을 잠가 동시에 올린 스토리가 상한을 함께 넘지 못하게 한다.
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id)
    and profile.type in ('student', 'teacher')
  -- `no key update`면 상한 검사끼리는 순서가 잡히면서도, 이 프로필을 참조하는 다른 행의 외래
  -- 키 검사(`key share`)는 막지 않는다.
  for no key update;

  if caller_profile_id is null then
    raise exception 'student or teacher profile required'
      using errcode = '42501';
  end if;

  select count(*)
  into active_count
  from public.stories as story
  where story.profile_id = caller_profile_id
    and (
      (story.status = 'ready' and story.expires_at > now())
      -- 미완성 업로드는 정리 작업이 지우는 48시간 동안 센다. 24시간만 세면 그 사이에 한도를
      -- 다시 채워 회수되지 않은 행을 두 배로 쌓을 수 있다.
      or (story.status = 'pending' and story.created_at > now() - interval '48 hours')
    );

  if active_count >= 20 then
    raise exception 'too many active stories'
      using errcode = '54000';
  end if;

  return caller_profile_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.accept_group_invite (
  p_token text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile public.profiles;
  invite_record private.group_invites;
  invited_group public.groups;
begin
  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id);

  if caller_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select invite.*
  into invite_record
  from private.group_invites as invite
  where invite.token = p_token;

  if invite_record.group_id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if invite_record.expires_at <= now() then
    raise exception 'invite expired' using errcode = '55000';
  end if;

  select group_record.*
  into invited_group
  from public.groups as group_record
  where group_record.id = invite_record.group_id;

  if invited_group.id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  -- 발급 시점에도 막지만, 링크가 만들어진 뒤 그룹이 공식으로 바뀌는 경로가 생기더라도
  -- 수락이 뚫리지 않도록 여기서 한 번 더 본다.
  if invited_group.kind = 'official' then
    raise exception 'official groups cannot be invited to' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = invited_group.id
      and membership.profile_id = caller_profile.id
  ) and not caller_profile.type = any(invite_record.allowed_profile_types) then
    raise exception 'profile type is not allowed by invite' using errcode = '42501';
  end if;

  -- 이미 멤버면 역할을 그대로 둔다. 관리자가 자기 링크를 눌러 멤버로 강등되면 안 된다.
  insert into public.group_memberships (group_id, profile_id, role)
  values (invited_group.id, caller_profile.id, 'member')
  on conflict on constraint group_memberships_pkey do nothing;

  -- 대기 중이던 가입 요청을 걷어 낸다. 남겨 두면 운영진 목록에 유령이 쌓이고, 요청이 남아
  -- 있는 동안에는 `update_group_settings`가 가입 정책 변경도 막는다.
  delete from public.group_join_requests as join_request
  where join_request.group_id = invited_group.id
    and join_request.profile_id = caller_profile.id;

  return invited_group.slug;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_lift_suspension (
  p_profile_id bigint
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.require_app_admin();
  lifted_suspension_id bigint;
begin
  perform private.require_recent_password_auth();

  perform 1 from public.profiles as profile where profile.id = p_profile_id for update;

  update private.profile_suspensions as suspension
  set ended_at = now(), cancelled_at = now(), cancelled_by_profile_id = caller_profile_id
  where suspension.profile_id = p_profile_id
    and suspension.ended_at is null
    and (suspension.expires_at is null or suspension.expires_at > now())
  returning suspension.id into lifted_suspension_id;

  if lifted_suspension_id is null then
    raise exception 'profile is not suspended' using errcode = '55000';
  end if;
  perform private.enqueue_suspension_email(lifted_suspension_id, 'lifted');

  return lifted_suspension_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."admin_lift_suspension"(bigint) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.admin_list_roster()
  RETURNS TABLE (
    profile_id            bigint,
    pub_id                text,
    name                  text,
    profile_type          public.profile_type,
    cohort                smallint,
    department            text,
    is_app_admin          boolean,
    approved_at           timestamp with time zone,
    is_suspended          boolean,
    suspension_expires_at timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_app_admin();

  -- 화면이 기수·유형별 인원 수를 세고 필터·정렬·CSV를 브라우저에서 하므로 승인된 사용자 전체를 한 번에 돌려준다.
  return query
  select
    profile.id, profile.pub_id, profile.name, profile.type, profile.cohort,
    profile.department, profile.role = 'admin', profile.status_updated_at,
    suspension.id is not null, suspension.expires_at
  from public.profiles as profile
  left join private.profile_suspensions as suspension
    on suspension.profile_id = profile.id
    and suspension.ended_at is null
    and (suspension.expires_at is null or suspension.expires_at > now())
  where profile.status = 'accepted'
    and profile.deleted_at is null
  order by profile.name, profile.id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."admin_list_roster"() FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.admin_set_app_admin (
  p_profile_id bigint,
  p_enabled    boolean
)
  RETURNS TABLE (
    profile_id   bigint,
    is_app_admin boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target_role public.app_role;
begin
  perform pg_advisory_xact_lock(hashtextextended('app-admin-role-mutations', 0));
  perform private.require_app_admin();
  perform private.require_recent_password_auth();

  if p_enabled is null then
    raise exception 'enabled must not be null' using errcode = '22023';
  end if;

  select profile.role
  into target_role
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;

  if target_role is null then
    raise exception 'accepted profile required' using errcode = '22023';
  end if;
  -- 정지된 관리자는 관리자 권한을 쓰지 못한다. 그런 관리자가 생기면 마지막 관리자 보호가 무너진다.
  if p_enabled and private.profile_suspended(p_profile_id) then
    raise exception 'suspended profiles cannot become app administrators' using errcode = '22023';
  end if;

  -- 일할 수 있는(정지되지 않은) 관리자만 센다.
  if not p_enabled and target_role = 'admin'
    and not private.profile_suspended(p_profile_id) and (
    select count(*)
    from public.profiles as profile
    where profile.role = 'admin'
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and not private.profile_suspended(profile.id)
  ) = 1 then
    raise exception 'the final app administrator cannot be demoted'
      using errcode = '55000';
  end if;

  update public.profiles
  set role = case
    when p_enabled then 'admin'::public.app_role
    else 'member'::public.app_role
  end
  where id = p_profile_id;

  return query select p_profile_id, p_enabled;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_suspend_profile (
  p_profile_id    bigint,
  p_reason        text,
  p_duration_days integer DEFAULT NULL::integer
)
  RETURNS TABLE (
    suspension_id bigint,
    expires_at    timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.require_app_admin();
  trimmed_reason text := btrim(coalesce(p_reason, ''));
  target_role public.app_role;
  suspension_expires_at timestamp with time zone;
  created_suspension_id bigint;
begin
  perform private.require_recent_password_auth();

  select profile.role
  into target_role
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;

  if target_role is null then
    raise exception 'accepted profile required' using errcode = '22023';
  end if;
  -- 관리자끼리 서로 잠그는 사고를 막는다. 관리자를 정지하려면 먼저 강등한다.
  if target_role = 'admin' then
    raise exception 'app administrators cannot be suspended' using errcode = '22023';
  end if;
  if char_length(trimmed_reason) not between 5 and 300 then
    raise exception 'reason must be 5 to 300 characters' using errcode = '22023';
  end if;
  if p_duration_days is not null and p_duration_days not between 1 and 180 then
    raise exception 'days must be between 1 and 180' using errcode = '22023';
  end if;

  update private.profile_suspensions as suspension
  set ended_at = suspension.expires_at
  where suspension.profile_id = p_profile_id
    and suspension.ended_at is null
    and suspension.expires_at <= now();
  if private.profile_suspended(p_profile_id) then
    raise exception 'profile is already suspended' using errcode = '55000';
  end if;

  suspension_expires_at := now() + make_interval(days => p_duration_days);
  insert into private.profile_suspensions (profile_id, reason, expires_at, suspended_by_profile_id)
  values (p_profile_id, trimmed_reason, suspension_expires_at, caller_profile_id)
  returning id into created_suspension_id;
  perform private.enqueue_suspension_email(created_suspension_id, 'suspended');

  return query select created_suspension_id, suspension_expires_at;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."admin_suspend_profile"(bigint, text, integer) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.cancel_utility_reservation (
  p_reservation_id bigint,
  p_effective_date date   DEFAULT NULL::date
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  korea_today date;
  reservation public.utility_reservations%rowtype;
begin
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id);

  if not found then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select target.*
  into reservation
  from public.utility_reservations as target
  where target.id = p_reservation_id
  for update;

  if not found or reservation.profile_id <> caller_profile_id then
    raise exception 'reservation not found'
      using errcode = '42501';
  end if;

  korea_today := (now() at time zone 'Asia/Seoul')::date;

  if reservation.recurring = false then
    if reservation.reservation_date < korea_today then
      raise exception 'past utility reservations cannot be cancelled'
        using errcode = '22023';
    end if;

    delete from public.utility_reservations
    where id = reservation.id;
    return;
  end if;

  if p_effective_date is null
    or p_effective_date < korea_today
    or p_effective_date < reservation.reservation_date
    or extract(dow from p_effective_date)
      <> extract(dow from reservation.reservation_date)
  then
    raise exception 'invalid recurring cancellation date'
      using errcode = '22023';
  end if;

  update public.utility_reservations
  set recurring_until = least(
    coalesce(recurring_until, p_effective_date),
    p_effective_date
  )
  where id = reservation.id;
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
  ) as suspension_content on true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_group (
  p_kind             public.group_kind,
  p_name             text,
  p_description      text                         DEFAULT ''::text,
  p_slug             text                         DEFAULT NULL::text,
  p_join_policy      public.group_join_policy     DEFAULT NULL::public.group_join_policy,
  p_identity_policy  public.group_identity_policy DEFAULT 'optional_anonymous'::public.group_identity_policy,
  p_posting_policy   public.group_posting_policy  DEFAULT 'members'::public.group_posting_policy,
  p_hide_staff_roles boolean                      DEFAULT false
)
  RETURNS TABLE (
    group_id uuid,
    slug     text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile public.profiles;
  chosen_policy public.group_join_policy;
  chosen_slug text;
  created_group_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id);

  if caller_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_kind = 'official'
    and (caller_profile.role <> 'admin' or caller_profile.type = 'teacher') then
    raise exception 'official group creation is not allowed' using errcode = '42501';
  end if;

  chosen_policy := coalesce(
    p_join_policy,
    case
      when p_kind = 'official' then 'open'::public.group_join_policy
      else 'invite_only'::public.group_join_policy
    end
  );

  -- 공개 그룹은 즉시 가입뿐이고, 승인 가입은 비공개 그룹에만 있다(§7.5).
  if p_kind = 'official' and chosen_policy <> 'open' then
    raise exception 'official groups must be open' using errcode = '22023';
  end if;

  if chosen_policy <> 'open' and nullif(btrim(p_slug), '') is not null then
    raise exception 'private groups cannot use a custom slug' using errcode = '22023';
  end if;

  if chosen_policy <> 'open' or nullif(btrim(p_slug), '') is null then
    chosen_slug := encode(extensions.gen_random_bytes(7), 'hex');
  else
    chosen_slug := lower(btrim(p_slug));
  end if;

  insert into public.groups (
    id, slug, slug_is_custom, kind, name, description, join_policy,
    identity_policy, posting_policy, hide_staff_roles, created_by
  ) values (
    created_group_id,
    chosen_slug,
    chosen_policy = 'open' and nullif(btrim(p_slug), '') is not null,
    p_kind,
    btrim(p_name),
    btrim(coalesce(p_description, '')),
    chosen_policy,
    p_identity_policy,
    p_posting_policy,
    p_hide_staff_roles,
    caller_profile.id
  );

  return query select created_group_id, chosen_slug;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_my_story (
  p_story_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  found_count integer;
begin
  with deleted as (
    delete from public.stories as story
    using public.profiles as profile
    where story.id = p_story_id
      and profile.id = story.profile_id
      and profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and not private.profile_suspended(profile.id)
    returning story.image_path, story.thumbnail_path
  ), queued as (
    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select 'story-media', path.object_path, 'story_media'
    from deleted
    cross join lateral (
      values (deleted.image_path), (deleted.thumbnail_path)
    ) as path(object_path)
    where path.object_path is not null
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run
  )
  select count(*) into found_count from deleted;

  if found_count = 0 then
    raise exception 'story owner required' using errcode = '42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.discover_groups (
  p_query              text     DEFAULT ''::text,
  p_include_joined     boolean  DEFAULT false,
  p_after_rank         smallint DEFAULT NULL::smallint,
  p_after_member_count bigint   DEFAULT NULL::bigint,
  p_after_id           uuid     DEFAULT NULL::uuid,
  p_limit              integer  DEFAULT 13
)
  RETURNS TABLE (
    group_id         uuid,
    slug             text,
    name             text,
    description      text,
    join_policy      public.group_join_policy,
    identity_policy  public.group_identity_policy,
    icon_path        text,
    cover_path       text,
    member_count     bigint,
    membership_state text,
    member_role      public.group_member_role,
    requested_at     timestamp with time zone,
    sort_rank        smallint
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile public.profiles;
  normalized_query text := lower(
    regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g')
  );
  cursor_field_count integer := pg_catalog.num_nonnulls(
    p_after_rank,
    p_after_member_count,
    p_after_id
  );
begin
  if cursor_field_count not in (0, 3) then
    raise exception 'all discovery cursor fields are required'
      using errcode = '22023';
  end if;

  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id);

  if caller_profile.id is null or caller_profile.type = 'teacher' then
    raise exception 'group discovery is not allowed' using errcode = '42501';
  end if;

  return query
  with ranked_groups as (
    select
      group_record.id as group_id,
      group_record.slug,
      group_record.name,
      group_record.description,
      group_record.join_policy,
      group_record.identity_policy,
      group_record.icon_path,
      group_record.cover_path,
      group_record.member_count,
      case
        when membership.profile_id is not null then 'member'
        when join_request.profile_id is not null then 'requested'
        else 'none'
      end as membership_state,
      membership.role as member_role,
      join_request.requested_at,
      case
        when normalized_query = '' then 0
        when group_record.search_name = normalized_query then 0
        when group_record.search_name like normalized_query || '%' then 1
        else 2
      end::smallint as sort_rank
    from public.groups as group_record
    left join public.group_memberships as membership
      on membership.group_id = group_record.id
      and membership.profile_id = caller_profile.id
    left join public.group_join_requests as join_request
      on join_request.group_id = group_record.id
      and join_request.profile_id = caller_profile.id
    where group_record.kind = 'unofficial'
      and group_record.join_policy = 'open'
      and (p_include_joined or membership.profile_id is null)
      and (
        normalized_query = ''
        or group_record.search_name like '%' || normalized_query || '%'
      )
  )
  select ranked_group.*
  from ranked_groups as ranked_group
  where p_after_rank is null
    or ranked_group.sort_rank > p_after_rank
    or (
      ranked_group.sort_rank = p_after_rank
      and ranked_group.member_count < p_after_member_count
    )
    or (
      ranked_group.sort_rank = p_after_rank
      and ranked_group.member_count = p_after_member_count
      and ranked_group.group_id > p_after_id
    )
  order by
    ranked_group.sort_rank,
    ranked_group.member_count desc,
    ranked_group.group_id
  limit least(greatest(coalesce(p_limit, 13), 1), 50);
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_profile_media (
  p_media_id uuid
)
  RETURNS public.profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  media public.profile_media_objects;
  activity_media public.profile_media_activity_objects;
  object_record storage.objects;
  activity_object_record storage.objects;
  current_profile public.profiles;
  updated_profile public.profiles;
  activity_post_id uuid := gen_random_uuid();
  activity_kind public.profile_media_activity_kind;
begin
  select item.* into media
  from public.profile_media_objects as item
  where item.id = p_media_id
  for update;

  if media.id is null or media.auth_user_id is distinct from caller_id then
    raise exception 'profile media owner required' using errcode = '42501';
  end if;
  if media.status <> 'pending' then
    raise exception 'profile media is not pending' using errcode = '55000';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.id = media.profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id)
  for update;

  if current_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select object.* into object_record
  from storage.objects as object
  where object.bucket_id = 'profile-media'
    and object.name = media.object_path;

  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from caller_id::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from media.size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from 'image/webp' then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;

  if media.slot = 'avatar' and media.activity_media_id is null then
    raise exception 'avatar activity media required' using errcode = '55000';
  end if;

  if media.activity_media_id is not null then
    select item.* into activity_media
    from public.profile_media_activity_objects as item
    where item.id = media.activity_media_id
    for update;

    if activity_media.id is null
      or activity_media.profile_id is distinct from media.profile_id
      or activity_media.auth_user_id is distinct from caller_id
      or activity_media.status <> 'pending' then
      raise exception 'profile activity media is not pending' using errcode = '55000';
    end if;

    select object.* into activity_object_record
    from storage.objects as object
    where object.bucket_id = 'profile-media'
      and object.name = activity_media.object_path;

    if activity_object_record.id is null then
      raise exception 'uploaded activity object not found' using errcode = 'P0002';
    end if;
    if activity_object_record.owner_id is distinct from caller_id::text then
      raise exception 'uploaded activity object owner does not match' using errcode = '42501';
    end if;
    if nullif(activity_object_record.metadata ->> 'size', '')::bigint is distinct from activity_media.size_bytes
      or activity_object_record.metadata ->> 'mimetype' is distinct from 'image/webp' then
      raise exception 'uploaded activity object metadata does not match' using errcode = '22023';
    end if;
  end if;

  update public.profile_media_objects
  set status = 'ready', ready_at = now()
  where id = media.id;

  if activity_media.id is not null then
    update public.profile_media_activity_objects
    set status = 'ready', ready_at = now()
    where id = activity_media.id;
  end if;

  if media.slot = 'avatar' then
    activity_kind := 'avatar_changed';
    update public.profiles
    set avatar_path = media.object_path
    where id = current_profile.id
    returning * into updated_profile;
  else
    activity_kind := 'cover_changed';
    update public.profiles
    set cover_path = media.object_path
    where id = current_profile.id
    returning * into updated_profile;
  end if;

  insert into public.posts (
    id,
    kind,
    body,
    timeline_profile_id,
    author_identity,
    display_author_profile_id,
    visibility,
    published_at,
    activity_kind,
    activity_media_path
  ) values (
    activity_post_id,
    'profile',
    '',
    current_profile.id,
    'identified',
    current_profile.id,
    'public',
    now(),
    activity_kind,
    coalesce(activity_media.object_path, media.object_path)
  );

  insert into private.post_authors (post_id, profile_id)
  values (activity_post_id, current_profile.id);

  return updated_profile;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_accepted_profile (
  p_pub_id text
)
  RETURNS TABLE (
    id                   bigint,
    pub_id               text,
    name                 text,
    role                 public.app_role,
    type                 public.profile_type,
    student_number       text,
    class_no             smallint,
    cohort               smallint,
    gender               public.profile_gender,
    academic_track       public.profile_academic_track,
    phone_number         text,
    avatar_path          text,
    birthday             date,
    description          text,
    dorm_room            smallint,
    allow_timeline_posts boolean,
    cover_path           text,
    contact_email        text,
    department           text,
    is_returning_student boolean
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select
    target.id, target.pub_id, target.name, target.role, target.type,
    target.student_number, target.class_no, target.cohort, target.gender,
    target.academic_track, target.phone_number, target.avatar_path,
    target.birthday, target.description, target.dorm_room,
    target.allow_timeline_posts, target.cover_path, target.contact_email,
    target.department, target.is_returning_student
  from public.profiles as target
  where lower(target.pub_id) = lower(btrim(p_pub_id))
    and target.status = 'accepted'
    and target.deleted_at is null
    and exists (
      select 1
      from public.profiles as viewer
      where viewer.auth_user_id = auth.uid()
        and viewer.status = 'accepted'
        and viewer.deleted_at is null
        and not private.profile_suspended(viewer.id)
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_my_suspension()
  RETURNS TABLE (
    reason     text,
    expires_at timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select suspension.reason, suspension.expires_at
  from private.profile_suspensions as suspension
  join public.profiles as profile on profile.id = suspension.profile_id
  where profile.auth_user_id = (select auth.uid())
    and profile.deleted_at is null
    and suspension.ended_at is null
    and (suspension.expires_at is null or suspension.expires_at > now());
$function$;

REVOKE ALL ON FUNCTION "public"."get_my_suspension"() FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.list_active_stories()
  RETURNS TABLE (
    story_id       bigint,
    pub_id         text,
    name           text,
    avatar_path    text,
    content        text,
    background     text,
    image_path     text,
    thumbnail_path text,
    image_width    integer,
    image_height   integer,
    link_url       text,
    published_at   timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with viewer as (
    select profile.type, profile.cohort
    from public.profiles as profile
    where profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and not private.profile_suspended(profile.id)
  ), visible as (
    select
      story.*,
      author.pub_id,
      author.name,
      author.avatar_path,
      viewer.type = 'student'
        and author.type = 'student'
        and author.cohort = viewer.cohort as same_cohort
    from viewer
    cross join public.stories as story
    join public.profiles as author
      on author.id = story.profile_id
      and author.status = 'accepted'
      and author.deleted_at is null
    where story.status = 'ready'
      and story.expires_at > now()
      -- private.can_read_story와 같은 판정이다. 행마다 그 함수를 부르지 않으려고 풀어 쓴다.
      and (
        author.type = 'teacher'
        or (author.type = 'student' and viewer.type in ('student', 'teacher'))
      )
  )
  select
    visible.id,
    visible.pub_id,
    visible.name,
    visible.avatar_path,
    visible.content,
    visible.background,
    visible.image_path,
    visible.thumbnail_path,
    visible.image_width,
    visible.image_height,
    visible.link_url,
    visible.published_at
  from visible
  order by
    visible.same_cohort desc,
    max(visible.published_at) over (partition by visible.profile_id) desc,
    visible.profile_id,
    visible.published_at,
    visible.id;
$function$;

CREATE OR REPLACE FUNCTION public.list_birthdays (
  p_reference_date date,
  p_scope          text DEFAULT 'month'::text
)
  RETURNS TABLE (
    pub_id               text,
    name                 text,
    avatar_path          text,
    cohort               smallint,
    is_returning_student boolean,
    birthday_month       smallint,
    birthday_day         smallint,
    birthday_date        date
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  range_start date;
  range_end date;
  current_cohort smallint;
begin
  if p_reference_date is null then
    raise exception 'reference date is required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles as viewer
    where viewer.auth_user_id = auth.uid()
      and viewer.status = 'accepted'
      and viewer.deleted_at is null
      and not private.profile_suspended(viewer.id)
  ) then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_scope = 'today' then
    range_start := p_reference_date;
    range_end := p_reference_date;
  elsif p_scope = 'month' then
    range_start := (p_reference_date - interval '1 month')::date;
    range_end := (p_reference_date + interval '1 month')::date;
  elsif p_scope = 'year' then
    range_start := p_reference_date;
    range_end := (p_reference_date + interval '1 year - 1 day')::date;
  else
    raise exception 'birthday scope must be today, month, or year' using errcode = '22023';
  end if;

  current_cohort := (extract(year from p_reference_date)::integer - 1995)::smallint;

  return query
  with eligible_profiles as (
    select
      profile.pub_id,
      profile.name,
      profile.avatar_path,
      profile.cohort,
      profile.is_returning_student,
      profile.birthday
    from public.profiles as profile
    where profile.status = 'accepted'
      and profile.deleted_at is null
      and profile.birthday is not null
      and (
        profile.type = 'teacher'
        or (
          profile.type = 'student'
          and (
            (
              profile.is_returning_student
              and profile.cohort = current_cohort - 3
            )
            or (
              not profile.is_returning_student
              and profile.cohort between current_cohort - 2 and current_cohort
            )
          )
        )
      )
  ), anniversaries as (
    select
      profile.pub_id,
      profile.name,
      profile.avatar_path,
      profile.cohort,
      profile.is_returning_student,
      extract(month from profile.birthday)::smallint as birthday_month,
      extract(day from profile.birthday)::smallint as birthday_day,
      make_date(
        calendar_year.value,
        extract(month from profile.birthday)::integer,
        least(
          extract(day from profile.birthday)::integer,
          extract(
            day from (
              make_date(
                calendar_year.value,
                extract(month from profile.birthday)::integer,
                1
              ) + interval '1 month - 1 day'
            )
          )::integer
        )
      ) as birthday_date
    from eligible_profiles as profile
    cross join lateral generate_series(
      extract(year from range_start)::integer,
      extract(year from range_end)::integer
    ) as calendar_year(value)
  )
  select
    anniversary.pub_id,
    anniversary.name,
    anniversary.avatar_path,
    anniversary.cohort,
    anniversary.is_returning_student,
    anniversary.birthday_month,
    anniversary.birthday_day,
    anniversary.birthday_date
  from anniversaries as anniversary
  where anniversary.birthday_date between range_start and range_end
  order by anniversary.birthday_date, anniversary.name, anniversary.pub_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_profile_media (
  p_slot                public.profile_media_slot,
  p_size_bytes          bigint,
  p_width               integer,
  p_height              integer,
  p_activity_size_bytes bigint                    DEFAULT NULL::bigint,
  p_activity_width      integer                   DEFAULT NULL::integer,
  p_activity_height     integer                   DEFAULT NULL::integer
)
  RETURNS TABLE (
    media_id             uuid,
    object_path          text,
    activity_media_id    uuid,
    activity_object_path text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  owner_profile_id bigint;
  created_id uuid := gen_random_uuid();
  created_activity_id uuid;
begin
  select profile.id
  into owner_profile_id
  from public.profiles as profile
  where profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id);

  if owner_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_slot = 'avatar' then
    if p_activity_size_bytes is null or p_activity_width is null or p_activity_height is null then
      raise exception 'avatar activity rendition required' using errcode = '22023';
    end if;
    created_activity_id := gen_random_uuid();

    insert into public.profile_media_activity_objects (
      id, profile_id, auth_user_id, object_path, size_bytes, width, height
    ) values (
      created_activity_id,
      owner_profile_id,
      caller_id,
      caller_id::text || '/avatar/' || created_activity_id::text,
      p_activity_size_bytes,
      p_activity_width,
      p_activity_height
    );
  elsif p_activity_size_bytes is not null or p_activity_width is not null or p_activity_height is not null then
    raise exception 'cover media does not use an activity rendition' using errcode = '22023';
  end if;

  insert into public.profile_media_objects (
    id, profile_id, auth_user_id, slot, object_path, size_bytes, width, height, activity_media_id
  ) values (
    created_id,
    owner_profile_id,
    caller_id,
    p_slot,
    caller_id::text || '/' || p_slot::text || '/' || created_id::text,
    p_size_bytes,
    p_width,
    p_height,
    created_activity_id
  );

  return query select created_id,
    caller_id::text || '/' || p_slot::text || '/' || created_id::text,
    created_activity_id,
    case when created_activity_id is not null
      then caller_id::text || '/avatar/' || created_activity_id::text
    end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_image_story (
  p_story_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  story public.stories;
  object_record storage.objects;
  published timestamptz := now();
begin
  select item.*
  into story
  from public.stories as item
  join public.profiles as profile
    on profile.id = item.profile_id
  where item.id = p_story_id
    and profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id)
  for update of item;

  if story.id is null then
    raise exception 'story owner required' using errcode = '42501';
  end if;
  if story.status <> 'pending' then
    raise exception 'story is not pending' using errcode = '55000';
  end if;

  select object.*
  into object_record
  from storage.objects as object
  where object.bucket_id = 'story-media'
    and object.name = story.image_path;

  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from caller_id::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from story.image_size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from 'image/webp' then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;

  -- 축소본은 크기를 미리 알리지 않지만 레일이 작성자마다 받는 파일이라 클라이언트 압축
  -- 정책(`card`)의 상한을 여기서도 지킨다. 넘으면 모든 뷰어의 홈이 무거워진다.
  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'story-media'
      and object.name = story.thumbnail_path
      and object.owner_id = caller_id::text
      and object.metadata ->> 'mimetype' = 'image/webp'
      and nullif(object.metadata ->> 'size', '')::bigint <= 524288
  ) then
    raise exception 'uploaded thumbnail not found' using errcode = 'P0002';
  end if;

  update public.stories
  set status = 'ready',
    published_at = published,
    expires_at = published + interval '24 hours'
  where id = story.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_my_profile_media (
  p_slot text
)
  RETURNS public.profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  current_profile public.profiles;
  updated_profile public.profiles;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_slot not in ('avatar', 'cover') then
    raise exception 'invalid profile media slot' using errcode = '22023';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id)
  for update;

  if current_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_slot = 'avatar' then
    update public.profiles
    set avatar_path = null
    where id = current_profile.id
    returning * into updated_profile;
  else
    update public.profiles
    set cover_path = null
    where id = current_profile.id
    returning * into updated_profile;
  end if;

  return updated_profile;
end;
$function$;

CREATE OR REPLACE FUNCTION public.search_directory (
  p_query text DEFAULT ''::text
)
  RETURNS TABLE (
    result_kind text,
    result_id   text,
    result_name text,
    avatar_path text,
    sort_rank   smallint
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile public.profiles;
  normalized_query text := lower(
    regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g')
  );
begin
  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id);

  if caller_profile.id is null then
    raise exception 'search requires an accepted profile' using errcode = '42501';
  end if;

  if char_length(normalized_query) < 2 then
    return;
  end if;

  return query
  (
    select
      'profile'::text,
      person.pub_id,
      person.name,
      person.avatar_path,
      case
        when person.search_name = normalized_query then 0
        when person.search_name like normalized_query || '%' then 1
        else 2
      end::smallint
    from public.profiles as person
    where person.status = 'accepted'
      and person.deleted_at is null
      and person.search_name like '%' || normalized_query || '%'
    order by 5, person.name
    limit 5
  )
  union all
  (
    select
      'group'::text,
      group_record.slug,
      group_record.name,
      group_record.icon_path,
      case
        when group_record.search_name = normalized_query then 0
        when group_record.search_name like normalized_query || '%' then 1
        else 2
      end::smallint
    from public.groups as group_record
    where caller_profile.type <> 'teacher'
      and (
        group_record.kind = 'official'
        or group_record.join_policy = 'open'
        or exists (
          select 1
          from public.group_memberships as membership
          where membership.group_id = group_record.id
            and membership.profile_id = caller_profile.id
        )
      )
      and group_record.search_name like '%' || normalized_query || '%'
    order by 5, group_record.name
    limit 5
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_my_profile (
  p_name                 text,
  p_description          text                          DEFAULT NULL::text,
  p_birthday             date                          DEFAULT NULL::date,
  p_phone_number         text                          DEFAULT NULL::text,
  p_contact_email        text                          DEFAULT NULL::text,
  p_gender               public.profile_gender         DEFAULT NULL::public.profile_gender,
  p_cohort               smallint                      DEFAULT NULL::smallint,
  p_academic_track       public.profile_academic_track DEFAULT NULL::public.profile_academic_track,
  p_department           text                          DEFAULT NULL::text,
  p_class_no             smallint                      DEFAULT NULL::smallint,
  p_dorm_room            smallint                      DEFAULT NULL::smallint,
  p_allow_timeline_posts boolean                       DEFAULT true,
  p_is_returning_student boolean                       DEFAULT false,
  p_pub_id               text                          DEFAULT NULL::text
)
  RETURNS public.profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  current_profile public.profiles;
  updated_profile public.profiles;
  next_pub_id text := nullif(btrim(lower(coalesce(p_pub_id, ''))), '');
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and not private.profile_suspended(profile.id)
  for update;

  if current_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  -- 공개 ID를 비워 보내면 바꾸지 않겠다는 뜻이다. 형식과 예약어는 profiles의 check
  -- 제약이 판정하고, 여기서는 선점 여부만 미리 본다. 고유 인덱스가 뒤를 받치므로 이
  -- 검사는 경합을 막으려는 것이 아니라 흔한 실패에 23505를 붙여 주기 위한 것이다 (§12.2).
  next_pub_id := coalesce(next_pub_id, current_profile.pub_id);

  if next_pub_id <> lower(current_profile.pub_id)
    and exists (
      select 1
      from public.profiles as other
      where lower(other.pub_id) = next_pub_id
    ) then
    raise exception 'public id already taken' using errcode = '23505';
  end if;

  if char_length(coalesce(p_description, '')) > 500 then
    raise exception 'description must be at most 500 characters'
      using errcode = '22001';
  end if;

  if p_department is not null and char_length(btrim(p_department)) > 100 then
    raise exception 'department must be at most 100 characters'
      using errcode = '22001';
  end if;

  if current_profile.type in ('student', 'alumni')
    and (
      p_gender is null
      or p_cohort is null
      or p_academic_track is null
    ) then
    raise exception 'academic profile fields are required'
      using errcode = '22023';
  end if;

  if current_profile.type = 'student' and p_birthday is null then
    raise exception 'student birthday is required'
      using errcode = '22023';
  end if;

  update public.profiles
  set
    pub_id = next_pub_id,
    name = btrim(p_name),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    birthday = p_birthday,
    phone_number = nullif(btrim(coalesce(p_phone_number, '')), ''),
    contact_email = nullif(btrim(coalesce(p_contact_email, '')), ''),
    allow_timeline_posts = p_allow_timeline_posts,

    is_returning_student = case
      when current_profile.type = 'student'
        then p_is_returning_student
      else false
    end,

    gender = case
      when current_profile.type in ('student', 'alumni') then p_gender
      else null
    end,

    cohort = current_profile.cohort,

    academic_track = case
      when current_profile.type in ('student', 'alumni')
        then p_academic_track
      else null
    end,

    department = case
      when current_profile.type = 'student'
        then nullif(btrim(coalesce(p_department, '')), '')
      else null
    end,

    class_no = case
      when current_profile.type = 'student' then p_class_no
      else null
    end,

    dorm_room = case
      when current_profile.type = 'student' then p_dorm_room
      else null
    end

  where id = current_profile.id
  returning * into updated_profile;

  return updated_profile;
end;
$function$;

ALTER TABLE "private"."notification_delivery_outbox"
  ADD CONSTRAINT "notification_delivery_outbox_source" CHECK ((num_nonnulls(notification_id, message_id, suspension_id) = 1));

ALTER TABLE "private"."notification_delivery_outbox"
  ADD CONSTRAINT "notification_delivery_outbox_suspension_shape" CHECK ((((suspension_id IS NULL) AND (suspension_event IS NULL)) OR ((suspension_id IS
    NOT NULL) AND (suspension_event = ANY (ARRAY['suspended'::text, 'lifted'::text])) AND (channel = 'email'::private.notification_delivery_channel))));

ALTER TABLE "private"."profile_suspensions"
  ADD CONSTRAINT "profile_suspensions_cancelled_by_fkey" FOREIGN KEY (cancelled_by_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "private"."notification_delivery_outbox"
  ADD CONSTRAINT "notification_delivery_outbox_suspension_id_fkey" FOREIGN KEY (suspension_id) REFERENCES private.profile_suspensions(id) ON DELETE CASCADE;

ALTER TABLE "private"."profile_suspensions"
  ADD CONSTRAINT "profile_suspensions_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "private"."profile_suspensions"
  ADD CONSTRAINT "profile_suspensions_suspended_by_fkey" FOREIGN KEY (suspended_by_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX notification_delivery_suspension_unique_idx ON private.notification_delivery_outbox USING btree (suspension_id, suspension_event)
  WHERE (suspension_id IS NOT NULL);

CREATE UNIQUE INDEX profile_suspensions_active_idx ON private.profile_suspensions USING btree (profile_id)
  WHERE (ended_at IS NULL);

CREATE INDEX profile_suspensions_cancelled_by_idx ON private.profile_suspensions USING btree (cancelled_by_profile_id)
  WHERE (cancelled_by_profile_id IS NOT NULL);

CREATE INDEX profile_suspensions_profile_idx ON private.profile_suspensions USING btree (profile_id);

CREATE INDEX profile_suspensions_suspended_by_idx ON private.profile_suspensions USING btree (suspended_by_profile_id)
  WHERE (suspended_by_profile_id IS NOT NULL);

CREATE POLICY "profile_suspensions_deny_client_access" ON "private"."profile_suspensions"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

CREATE POLICY "profiles_select_accepted" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING (((status = 'accepted'::public.profile_status) AND (deleted_at IS NULL) AND (( SELECT private.current_profile_id() AS current_profile_id) IS NOT NULL)));

REVOKE ALL ON FUNCTION "private"."enqueue_suspension_email"(bigint, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."profile_suspended"(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."admin_lift_suspension"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_lift_suspension"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_lift_suspension"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_list_roster"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_list_roster"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_list_roster"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_suspend_profile"(bigint, text, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_suspend_profile"(bigint, text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_suspend_profile"(bigint, text, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_my_suspension"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_my_suspension"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_my_suspension"() TO "postgres";
