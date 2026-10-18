SET local check_function_bodies = off;

-- 집계된 답글 알림은 한 알림 행으로 답글마다 Push를 보낸다(기능 명세 §14.9). outbox 중복 방지를
-- 알림 행 단위에서 활동(event key) 단위로 옮긴다. 기존 행은 열이 비어 있고 알림 보존 기간이 지나면
-- 알림과 함께 사라진다. 기존 알림 행은 합치지 않는다.
ALTER TABLE private.notification_delivery_outbox ADD COLUMN notification_event_key text;

DROP INDEX private.notification_delivery_push_unique_idx;
CREATE UNIQUE INDEX notification_delivery_push_unique_idx
ON private.notification_delivery_outbox (notification_id, subscription_id, notification_event_key)
WHERE channel = 'web_push';

DROP FUNCTION private.enqueue_notification_push(uuid);

create or replace function private.notification_push_allowed(
  p_notification public.notifications,
  p_subscription_created_at timestamptz,
  p_subscription_expiration_time timestamptz
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  -- 집계 알림은 행이 먼저 있고 활동이 뒤에 붙는다. 구독 뒤에 새로 붙은 답글은 그 기기로 보내야
  -- 하므로 최초 생성 시각이 아니라 마지막 활동 시각과 비교한다.
  select p_subscription_created_at <= p_notification.last_activity_at
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

create or replace function private.enqueue_notification_push(
  p_notification_id uuid,
  p_event_key text
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
    notification_id, recipient_profile_id, subscription_id, channel, notification_event_key
  )
  select target.id, target.recipient_profile_id, subscription.id, 'web_push', p_event_key
  from private.web_push_subscriptions as subscription
  where subscription.profile_id = target.recipient_profile_id
    and subscription.gone_at is null
    and private.notification_push_allowed(
      target, subscription.created_at, subscription.expiration_time
    )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

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

    -- 집계된 활동도 Push는 따로 보낸다. 반응처럼 Push를 지원하지 않는 종류는 허용 검사에서 빠진다.
    perform private.enqueue_notification_push(created_notification_id, p_event_key);
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

    perform private.enqueue_notification_push(created_notification_id, p_event_key);
  end if;

  update private.notification_event_keys as event
  set notification_id = created_notification_id
  where event.event_key = p_event_key;

  return created_notification_id;
end;
$$;

create or replace function private.comment_actor_display_name(
  p_identity public.notification_actor_identity,
  p_profile_name text
) returns text
language sql immutable
set search_path = ''
as $$
  select case p_identity
    when 'identified' then coalesce(p_profile_name, '탈퇴한 사용자')
    when 'anonymous' then '익명'
    else '운영진'
  end;
$$;

create or replace function private.comment_reply_aggregate_key(p_parent_comment_id uuid)
returns text
language sql immutable
set search_path = ''
as $$
  select 'comment-replies:' || p_parent_comment_id::text;
$$;

create or replace function private.sync_comment_reply_notification(
  p_parent_comment_id uuid,
  p_removed_comment_id uuid default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  aggregate_key text := private.comment_reply_aggregate_key(p_parent_comment_id);
  target_notification_id uuid;
  latest_comment_id uuid;
  latest_identity public.notification_actor_identity;
  latest_profile_id bigint;
  latest_profile_name text;
  latest_avatar_path text;
  replier_count integer;
begin
  -- 새 답글을 모으는 emit_notification과 같은 잠금이다. 동시에 들어온 답글과 삭제가 서로의 결과를
  -- 덮어쓰지 않는다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(aggregate_key, 0));

  select event.notification_id into target_notification_id
  from private.notification_event_keys as event
  where event.event_key = aggregate_key;
  if target_notification_id is null then return; end if;

  -- 방금 단 답글은 create_post_comment가 아직 작성자 행을 넣기 전이다(댓글 insert 트리거에서
  -- 부른다). 작성자 행이 없는 답글은 그 답글이므로 작성자는 지금 호출자다.
  with replies as (
    select reply.id, reply.created_at, reply_author.profile_id,
      reply.author_identity::text::public.notification_actor_identity as identity,
      case reply.author_identity
        when 'staff' then 'staff'
        else reply.author_identity::text || ':' || reply_author.profile_id::text
      end as replier_key
    from public.post_comments as reply
    left join private.comment_authors as author on author.comment_id = reply.id
    cross join lateral (
      select coalesce(author.profile_id, private.current_profile_id()) as profile_id
    ) as reply_author
    join private.notification_event_keys as event
      on event.event_key = 'comment:' || reply.id::text
    where reply.parent_comment_id = p_parent_comment_id
      and reply.deleted_at is null
      and reply.id is distinct from p_removed_comment_id
      and event.notification_id = target_notification_id
  ), latest as (
    select replies.id, replies.identity, replies.profile_id
    from replies
    order by replies.created_at desc, replies.id desc
    limit 1
  )
  select latest.id, latest.identity, latest.profile_id, profile.name, profile.avatar_path,
    (select count(distinct replies.replier_key)::integer from replies)
  into latest_comment_id, latest_identity, latest_profile_id, latest_profile_name,
    latest_avatar_path, replier_count
  from latest
  left join public.profiles as profile on profile.id = latest.profile_id;

  if latest_comment_id is null then
    delete from public.notifications where id = target_notification_id;
    return;
  end if;

  update public.notifications
  set comment_id = latest_comment_id,
    actor_identity = latest_identity,
    actor_profile_id = case when latest_identity = 'identified' then latest_profile_id end,
    actor_display_name = private.comment_actor_display_name(latest_identity, latest_profile_name),
    actor_avatar_path = case when latest_identity = 'identified' then latest_avatar_path end,
    actor_count = replier_count
  where id = target_notification_id;
end;
$$;

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
  -- 답글만 부모 댓글 단위로 모은다. 게시물에 바로 단 댓글은 하나씩 알린다(기능 명세 §14.9).
  reply_aggregate_key text;
  emitted_notification_id uuid;
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
    reply_aggregate_key := private.comment_reply_aggregate_key(new.parent_comment_id);
  else
    select author.profile_id into recipient_profile_id
    from private.post_authors as author
    where author.post_id = new.post_id;
    notification_title := '내 게시물에 새 댓글이 등록되었습니다.';
  end if;

  select profile.* into actor_profile
  from public.profiles as profile where profile.id = actor_profile_id;
  emitted_notification_id := private.emit_notification(
    'comment:' || new.id::text,
    recipient_profile_id,
    (case when new.parent_comment_id is null then 'post_commented' else 'comment_replied' end)::public.notification_kind,
    'normal', 'content', actor_identity, actor_profile_id,
    private.comment_actor_display_name(actor_identity, actor_profile.name),
    case when actor_identity = 'identified' then actor_profile.avatar_path end,
    notification_title, target_post.group_id, new.post_id, new.id,
    target_post.timeline_profile_id,
    p_aggregate_key => reply_aggregate_key
  );
  -- emit_notification은 행위자 수를 활동마다 하나씩 늘리고 댓글 참조를 처음 답글에 둔다. 답글 집계는
  -- 서로 다른 작성자 수와 가장 최근 답글을 보여야 하므로 여기서 다시 맞춘다.
  if reply_aggregate_key is not null and emitted_notification_id is not null then
    perform private.sync_comment_reply_notification(new.parent_comment_id);
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."delete_post_comment"("p_comment_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint := private.current_profile_id();
  comment_record public.post_comments;
  target_post_id uuid;
  comment_group_id uuid;
  comment_post_title text;
  caller_role public.group_member_role;
  author_profile_id bigint;
  remaining_comment_count integer;
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

  select post.group_id, post.title into comment_group_id, comment_post_title
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
  if exists (
    select 1
    from private.feed_bump_events as bump
    where bump.comment_id = p_comment_id
  ) then
    raise exception 'effective #업 comments cannot be deleted' using errcode = '22023';
  end if;

  select author.profile_id into author_profile_id
  from private.comment_authors as author where author.comment_id = p_comment_id;

  -- 답글 집계 알림은 이 답글 하나 때문에 통째로 지우지 않는다. 남은 답글로 다시 맞추고, 남은 답글이
  -- 없을 때만 지운다(기능 명세 §14.9).
  if comment_record.parent_comment_id is not null then
    perform private.sync_comment_reply_notification(comment_record.parent_comment_id, p_comment_id);
  end if;
  -- 하드 삭제는 외래 키가 이 데이터를 정리하지만, 살아 있는 자식 때문에 답글이 tombstone으로
  -- 남는 경우에도 삭제된 댓글을 가리키는 데이터는 즉시 사라져야 한다.
  delete from public.notifications where comment_id = p_comment_id;
  delete from public.comment_mentions where comment_id = p_comment_id;

  if comment_record.depth = 0 then
    -- 최상위 댓글을 지우면 답글 묶음 전체가 사라진다(기능 명세 §9.4). 묶음이 통째로 숨는 이상
    -- 자리 표시가 필요 없으므로 하드 삭제한다.
    perform 1
    from public.post_comments as comment
    where comment.root_comment_id = p_comment_id
    order by comment.id
    for update;

    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select image.storage_bucket, image.object_path, 'comment_image'
    from public.comment_images as image
    join public.post_comments as comment on comment.id = image.comment_id
    where comment.root_comment_id = p_comment_id
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run;

    delete from public.post_comments as comment
    where comment.root_comment_id = p_comment_id;
  else
    -- 답글은 아래에 살아 있는 답글이 남아 있으면 대화 연결을 위해 자리 표시로 남아야 한다
    -- (기능 명세 §9.4). 자리 표시에 필요한 것은 트리 골격뿐이므로 본문은 그 자리에서 비운다
    -- (삭제 및 보존 정책 §7.2).
    update public.post_comments as comment
    set deleted_at = now(), body = ''
    where comment.id = p_comment_id;
  end if;

  -- 자식이 없는 자리 표시는 존재 이유가 없다. 잎에서부터 걷어내면 삭제만 남은 사슬이 조상까지
  -- 함께 사라진다. 이미지 경로는 행이 사라지기 전에 큐로 옮긴다.
  loop
    with doomed as (
      select comment.id
      from public.post_comments as comment
      where comment.post_id = target_post_id
        and comment.deleted_at is not null
        and not exists (
          select 1
          from public.post_comments as child
          where child.parent_comment_id = comment.id
        )
    ), queued as (
      insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
      select image.storage_bucket, image.object_path, 'comment_image'
      from public.comment_images as image
      join doomed on doomed.id = image.comment_id
      on conflict (bucket, object_path) do update
        set dry_run = queue.dry_run and excluded.dry_run
      returning 1
    )
    delete from public.post_comments as comment
    using doomed
    where comment.id = doomed.id;
    exit when not found;
  end loop;

  perform private.invoke_storage_cleanup(p_quiet => true);
  if caller_profile_id <> author_profile_id then
    -- 댓글 원문은 싣지 않는다(기능 명세 §14.8). 대신 댓글이 달려 있던 게시물의 제목으로
    -- 어느 댓글이었는지 짚어준다. 제목은 원문이 아니고 작성자가 이미 읽을 수 있던 값이다.
    -- 프로필 타임라인 글은 제목이 없어서 예전 문장으로 떨어진다.
    perform private.emit_notification(
      'comment-moderated:' || p_comment_id::text,
      author_profile_id, 'comment_moderated', 'high', 'moderation', 'staff',
      caller_profile_id, '운영진', null,
      case when comment_post_title is null
        then '운영진이 댓글을 삭제했습니다.'
        else '“' || comment_post_title
          || '” 게시물에 남긴 내 댓글을 운영진이 삭제했습니다.'
      end,
      comment_group_id, target_post_id
    );
  end if;

  -- `create_post_comment`와 같은 이유로 삭제 트리거가 갱신한 정본 count를 돌려준다. 삭제는
  -- 답글 묶음과 자식 없는 자리 표시까지 함께 걷어내므로, 클라이언트가 지워진 개수를 세어
  -- 빼려면 그 규칙을 그대로 옮겨 적어야 한다. 두 벌이 되면 언젠가 갈라진다.
  select post.comment_count into remaining_comment_count
  from public.posts as post
  where post.id = target_post_id;
  return remaining_comment_count;
end;
$$;

REVOKE ALL ON FUNCTION private.enqueue_notification_push(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.comment_actor_display_name(public.notification_actor_identity, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.comment_reply_aggregate_key(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.sync_comment_reply_notification(uuid, uuid) FROM PUBLIC;
