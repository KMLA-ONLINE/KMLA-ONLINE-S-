-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

-- 소프트 삭제로 남아 있던 그룹을 실제로 지운다. 컬럼만 떨어뜨리면 이미 삭제된 그룹이 목록에
-- 되살아나므로 이 블록은 반드시 DROP COLUMN 앞에 온다.
select private.purge_posts(array(
  select post.id
  from public.posts as post
  join public.groups as group_record on group_record.id = post.group_id
  where group_record.deleted_at is not null
));

delete from public.notifications
where group_id in (select id from public.groups where deleted_at is not null);

insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
select 'group-media', media.object_path, 'group_media'
from public.group_media_objects as media
join public.groups as group_record on group_record.id = media.group_id
where group_record.deleted_at is not null
on conflict (bucket, object_path) do update
  set dry_run = queue.dry_run and excluded.dry_run;

delete from public.groups where deleted_at is not null;

-- 컬럼을 붙들고 있는 트리거와 정책을 먼저 푼다. 둘 중 하나라도 남아 있으면 DROP COLUMN 이
-- 거부된다.
CREATE OR REPLACE TRIGGER groups_notify_changed
  AFTER UPDATE OF join_policy, identity_policy, posting_policy ON public.groups
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_group_changed();

ALTER POLICY groups_select_visible ON public.groups USING ((EXISTS ( SELECT 1
   FROM public.profiles profile
  WHERE
    ((profile.id = private.current_profile_id()) AND (((profile.role = 'admin'::public.app_role) AND (groups.kind = 'official'::public.group_kind)) OR ((profile.type = ANY
    (ARRAY['student'::public.profile_type, 'alumni'::public.profile_type])) AND
    ((groups.kind = 'official'::public.group_kind) OR ((groups.kind = 'unofficial'::public.group_kind) AND (groups.join_policy <> 'invite_only'::public.group_join_policy)))) OR
    ((groups.kind = 'unofficial'::public.group_kind) AND private.is_group_member(groups.id)))))));

ALTER TABLE public.groups
  DROP COLUMN deleted_at;

CREATE OR REPLACE FUNCTION private.assert_group_invite_manager (
  p_group_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target_group public.groups;
  caller_role public.group_member_role;
begin
  select group_record.*
  into target_group
  from public.groups as group_record
  where group_record.id = p_group_id;

  if target_group.id is null then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  -- 공식 그룹에는 초대할 사람이 없다. 승인된 재학생은 트리거로 자동 가입하고, 교사는
  -- `sync_student_official_memberships`가 다시 지운다.
  if target_group.kind = 'official' then
    raise exception 'official groups cannot be invited to' using errcode = '55000';
  end if;

  select membership.role
  into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = private.current_profile_id();

  if caller_role is null or caller_role not in ('owner', 'admin') then
    raise exception 'group staff required' using errcode = '42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.can_access_feed_post (
  p_post_id    uuid,
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
    from public.posts as post
    join private.post_authors as author on author.post_id = post.id
    left join public.profiles as timeline
      on timeline.id = post.timeline_profile_id
      and timeline.status = 'accepted'
      and timeline.deleted_at is null
    left join public.profiles as viewer
      on viewer.id = p_profile_id
      and viewer.status = 'accepted'
      and viewer.deleted_at is null
    where post.id = p_post_id
      and post.published_at is not null
      and (
        (
          post.kind = 'group'
          and exists (
            select 1
            from public.group_memberships as membership
            join public.groups as group_record on group_record.id = membership.group_id
            where membership.group_id = post.group_id
              and membership.profile_id = p_profile_id
          )
        )
        or (
          post.kind = 'profile'
          and post.visibility = 'public'
          and timeline.id is not null
          and (
            author.profile_id = post.timeline_profile_id
            or (
              (
                private.feed_profile_cohorts(p_profile_id)
                  && private.feed_profile_cohorts(post.timeline_profile_id)
              )
              and viewer.gender = timeline.gender
            )
          )
          and (
            post.activity_kind is null
            or post.timeline_profile_id = p_profile_id
            or timeline.type = 'teacher'
            or (
              viewer.cohort = timeline.cohort
              and viewer.gender = timeline.gender
            )
          )
        )
      )
  );
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
    );
$function$;

CREATE OR REPLACE FUNCTION private.notify_group_changed()
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
  -- 그룹 삭제 알림은 여기서 보내지 않는다. 삭제가 UPDATE 가 아니라 DELETE 라 트리거가 볼 수
  -- 없고, 알림이 그룹 이름을 제목에 실어야 하기 때문이다. public.delete_group 이 보낸다.
  if old.join_policy is distinct from new.join_policy
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
    and profile.deleted_at is null;

  if caller_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  -- 프로필 종류를 보지 않는다. `group_memberships_join_open` 정책은 교사를 막지만 그 정책이
  -- 막는 것은 "스스로 가입"이고, 초대 수락은 definer라 그 옆을 지난다. 교사는 그룹을 찾을
  -- 수도 가입 요청을 넣을 수도 없으므로 초대가 교사의 유일한 가입 경로다.

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

CREATE OR REPLACE FUNCTION public.cancel_group_anonymous_activity_restriction (
  p_source_kind text,
  p_source_id   uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_group_id uuid;
  target_profile_id bigint;
  caller_role public.group_member_role;
  target_restriction private.group_anonymous_activity_restrictions;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_source_kind not in ('post', 'comment') or p_source_id is null then
    raise exception 'invalid anonymous moderation source' using errcode = '22023';
  end if;
  if p_source_kind = 'post' then
    select post.group_id, author.profile_id into target_group_id, target_profile_id
    from public.posts as post
    join public.groups as group_record on group_record.id = post.group_id
    join private.post_authors as author on author.post_id = post.id
    where post.id = p_source_id and post.kind = 'group'
      and post.author_identity = 'anonymous'
      and post.published_at is not null;
  else
    select post.group_id, author.profile_id into target_group_id, target_profile_id
    from public.post_comments as comment
    join public.posts as post on post.id = comment.post_id and post.kind = 'group'
      and post.published_at is not null
    join public.groups as group_record on group_record.id = post.group_id
    join private.comment_authors as author on author.comment_id = comment.id
    where comment.id = p_source_id and comment.author_identity = 'anonymous'
      and comment.deleted_at is null;
  end if;
  if target_profile_id is null then
    raise exception 'anonymous moderation source not found' using errcode = 'P0002';
  end if;

  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = target_group_id and membership.profile_id = caller_profile_id;
  if caller_role not in ('owner', 'admin') then
    raise exception 'group anonymous moderation is not allowed' using errcode = '42501';
  end if;
  if target_profile_id = caller_profile_id then
    raise exception 'cannot moderate own anonymous activity' using errcode = '42501';
  end if;

  perform private.lock_group_anonymous_activity_target(target_group_id, target_profile_id);
  perform 1 from public.group_memberships as membership
  where membership.group_id = target_group_id and membership.profile_id = target_profile_id
  for update;
  select restriction.* into target_restriction
  from private.group_anonymous_activity_restrictions as restriction
  where restriction.group_id = target_group_id and restriction.profile_id = target_profile_id
  order by restriction.created_at desc, restriction.id desc limit 1 for update;
  if target_restriction.id is null then
    raise exception 'anonymous activity restriction not found' using errcode = 'P0002';
  end if;
  if target_restriction.cancelled_at is not null then
    raise exception 'anonymous activity restriction already cancelled' using errcode = '55000';
  end if;
  if target_restriction.ended_at is not null or target_restriction.expires_at <= now() then
    raise exception 'anonymous activity restriction is expired' using errcode = '55000';
  end if;
  update private.group_anonymous_activity_restrictions
  set ended_at = now(), cancelled_at = now(), cancelled_by_profile_id = caller_profile_id
  where id = target_restriction.id;
  return target_restriction.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.commit_group_post (
  p_post_id        uuid,
  p_title          text,
  p_body           text,
  p_attachment_ids uuid[],
  p_publish        boolean DEFAULT false,
  p_category_id    uuid    DEFAULT NULL::uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  target_group_id uuid;
  target_author_identity public.post_identity;
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.group_id, post.author_identity into target_group_id, target_author_identity
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group';
  if target_group_id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can commit this post' using errcode = '42501';
  end if;
  if coalesce(p_publish, false) and target_author_identity = 'anonymous' then
    perform private.lock_group_anonymous_activity_target(
      target_group_id, caller_profile_id
    );
  end if;

  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = target_group_id
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
    and post.group_id = target_group_id
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can commit this post' using errcode = '42501';
  end if;
  if coalesce(p_publish, false) and post_record.published_at is not null then
    raise exception 'post is already published' using errcode = '55000';
  end if;
  if coalesce(p_publish, false) then
    if group_posting_policy = 'staff'
      and member_role not in ('owner', 'admin', 'manager') then
      raise exception 'group posting is restricted to staff' using errcode = '42501';
    end if;
    if post_record.author_identity = 'anonymous'
      and group_identity_policy = 'identified' then
      raise exception 'anonymous posting is not allowed' using errcode = '42501';
    end if;
    if post_record.author_identity = 'anonymous' then
      perform private.assert_group_anonymous_activity_allowed(
        target_group_id, caller_profile_id
      );
    end if;
    if post_record.author_identity = 'staff'
      and member_role not in ('owner', 'admin', 'manager') then
      raise exception 'staff identity is not allowed' using errcode = '42501';
    end if;
  end if;
  if nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 100 then
    raise exception 'title must contain between 1 and 100 characters' using errcode = '22023';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.group_categories as category
    where category.id = p_category_id and category.group_id = post_record.group_id
  ) then
    raise exception 'category must belong to the group' using errcode = '22023';
  end if;

  perform private.apply_post_commit(p_post_id, p_body, p_attachment_ids);
  update public.posts
  set title = btrim(p_title), body = coalesce(p_body, ''), category_id = p_category_id,
    published_at = case when coalesce(p_publish, false) then now() else published_at end,
    edited_at = case when published_at is not null then now() else null end
  where id = p_post_id;
  return p_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_group_post_upload_draft (
  p_group_id        uuid,
  p_author_identity public.post_identity
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
  created_post_id uuid;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_author_identity is null then
    raise exception 'author identity is required' using errcode = '22023';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.lock_group_anonymous_activity_target(p_group_id, caller_profile_id);
  end if;

  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = p_group_id
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if group_posting_policy = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'group posting is restricted to staff' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' and group_identity_policy = 'identified' then
    raise exception 'anonymous posting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.assert_group_anonymous_activity_allowed(p_group_id, caller_profile_id);
  end if;
  if p_author_identity = 'staff' and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;

  insert into public.posts (
    kind, body, group_id, title, author_identity, display_author_profile_id
  ) values (
    'group', '', p_group_id, '[private upload draft]', p_author_identity,
    case when p_author_identity = 'identified' then caller_profile_id end
  ) returning id into created_post_id;
  insert into private.post_authors (post_id, profile_id)
  values (created_post_id, caller_profile_id);
  return created_post_id;
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
  recipient record;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  select group_record.* into target_group
  from public.groups as group_record
  where group_record.id = p_group_id
  for update;
  if target_group.id is null then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  -- 공식 그룹은 일반 그룹 운영 권한과 분리한다. 앱 관리자는 소유자·멤버십과 무관하게 학교
  -- 공간을 정리할 수 있지만, 비공식 그룹은 계속 소유자만 지운다.
  if target_group.kind = 'official' then
    perform private.require_app_admin();
  elsif not exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = caller_profile_id
      and membership.role = 'owner'
  ) then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  -- 그룹의 게시물은 첨부·댓글·반응과 함께 즉시 사라진다(삭제 및 보존 정책 §5.2).
  perform private.purge_posts(array(
    select post.id from public.posts as post where post.group_id = p_group_id
  ));

  -- 그룹을 가리키던 알림은 갈 곳이 없다. 삭제 알림을 새로 보내기 전에 걷어낸다.
  delete from public.notifications where group_id = p_group_id;

  -- 삭제 알림만 이름을 제목에 싣는다. 행이 사라진 뒤에는 그룹 이름을 조회할 수 없고, 알림함은
  -- `notifications.group_id`로 이름을 붙이기 때문이다. 게시물 운영 조치 알림이 제목을 싣는 것과
  -- 같은 이유다. 트리거가 아니라 여기서 보내는 것도 UPDATE 가 아니라 DELETE 이기 때문이다.
  for recipient in
    select membership.profile_id
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id <> caller_profile_id
  loop
    perform private.emit_notification(
      'group-deleted:' || p_group_id::text || ':' || recipient.profile_id::text,
      recipient.profile_id, 'group_deleted', 'high', 'group', 'staff',
      caller_profile_id, '운영진', null,
      '“' || target_group.name || '” 그룹이 영구 삭제되었습니다.'
    );
  end loop;

  -- 미디어 경로를 큐로 옮긴 뒤 그룹을 지운다. 멤버십·가입 요청·초대·카테고리·미디어 행은 모두
  -- 외래 키 CASCADE로 함께 사라진다.
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'group-media', media.object_path, 'group_media'
  from public.group_media_objects as media
  where media.group_id = p_group_id
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;

  delete from public.groups where id = p_group_id;

  perform private.invoke_storage_cleanup(p_quiet => true);
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
  comment_post_title text;
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
        then '댓글이 운영자에 의해 삭제되었습니다.'
        else '“' || comment_post_title
          || '” 게시물에 남긴 내 댓글이 운영자에 의해 삭제되었습니다.'
      end,
      comment_group_id, target_post_id
    );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_group_invite_preview (
  p_token text
)
  RETURNS TABLE (
    group_id        uuid,
    slug            text,
    name            text,
    description     text,
    join_policy     public.group_join_policy,
    identity_policy public.group_identity_policy,
    posting_policy  public.group_posting_policy,
    member_count    bigint,
    expires_at      timestamp with time zone,
    already_member  boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  return query
  select
    group_record.id,
    group_record.slug,
    group_record.name,
    group_record.description,
    group_record.join_policy,
    group_record.identity_policy,
    group_record.posting_policy,
    group_record.member_count,
    invite.expires_at,
    exists (
      select 1
      from public.group_memberships as membership
      where membership.group_id = group_record.id
        and membership.profile_id = caller_profile_id
    )
  from private.group_invites as invite
  join public.groups as group_record on group_record.id = invite.group_id
  where invite.token = p_token
    and invite.expires_at > now()
    and group_record.kind = 'unofficial';
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_notifications (
  p_before_last_activity_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_before_id               uuid                     DEFAULT NULL::uuid,
  p_limit                   integer                  DEFAULT 20
)
  RETURNS TABLE (
    id                     uuid,
    kind                   public.notification_kind,
    importance             public.notification_importance,
    category               public.notification_category,
    actor_identity         public.notification_actor_identity,
    actor_display_name     text,
    actor_avatar_path      text,
    actor_count            integer,
    group_id               uuid,
    group_name             text,
    post_id                uuid,
    comment_id             uuid,
    target_profile_id      bigint,
    reservation_id         bigint,
    title                  text,
    detail                 text,
    restriction_expires_at timestamp with time zone,
    created_at             timestamp with time zone,
    last_activity_at       timestamp with time zone,
    read_at                timestamp with time zone
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

  -- 알림함 한 행은 "어디서 온 소식인가"를 말해야 한다. 특히 그룹 새 게시물 알림의 제목은
  -- 게시물 제목 그대로라서, 그룹 이름이 없으면 어느 그룹 글인지 알 방법이 없다.
  -- 이미 recipient 본인의 알림만 돌려주고 그 행이 group_id를 들고 있으므로 이름을 함께
  -- 내보내도 새로 드러나는 정보는 없다.
  --
  -- 그룹 삭제 알림만 그룹 이름을 제목에 싣는다. 그룹 행이 하드 삭제로 사라지면 여기에서
  -- 이름을 붙일 수 없기 때문이다(삭제 및 보존 정책 §5.2). 이름이 비는 경우는 그 알림과
  -- 애초에 그룹과 무관한 알림뿐이다.
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
$function$;

CREATE OR REPLACE FUNCTION public.publish_group_post (
  p_post_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  target_group_id uuid;
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.group_id into target_group_id
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group';
  if target_group_id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can publish this post' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
    and post.group_id = target_group_id;
  if post_record.author_identity = 'anonymous' then
    perform private.lock_group_anonymous_activity_target(
      target_group_id, caller_profile_id
    );
  end if;

  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = target_group_id
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
    and post.group_id = target_group_id
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can publish this post' using errcode = '42501';
  end if;
  if post_record.published_at is not null then
    return p_post_id;
  end if;
  if group_posting_policy = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'group posting is restricted to staff' using errcode = '42501';
  end if;
  if post_record.author_identity = 'anonymous'
    and group_identity_policy = 'identified' then
    raise exception 'anonymous posting is not allowed' using errcode = '42501';
  end if;
  if post_record.author_identity = 'anonymous' then
    perform private.assert_group_anonymous_activity_allowed(
      target_group_id, caller_profile_id
    );
  end if;
  if post_record.author_identity = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status = 'pending'
  ) then
    raise exception 'pending attachments must be finalized or deleted' using errcode = '55000';
  end if;
  if nullif(btrim(post_record.body), '') is null and not exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status = 'ready'
  ) then
    raise exception 'published post requires a body or ready attachment' using errcode = '22023';
  end if;

  update public.posts set published_at = now() where id = p_post_id;
  return p_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_my_notification_destination (
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
      where group_record.id = target.group_id;
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
    where group_record.id = target.group_id;
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

CREATE OR REPLACE FUNCTION public.restrict_group_anonymous_activity (
  p_source_kind   text,
  p_source_id     uuid,
  p_reason        text,
  p_duration_days integer
)
  RETURNS TABLE (
    restriction_id uuid,
    expires_at     timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_group_id uuid;
  target_profile_id bigint;
  caller_role public.group_member_role;
  created_restriction_id uuid;
  restriction_expires_at timestamptz;
  trimmed_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_source_kind not in ('post', 'comment') or p_source_id is null then
    raise exception 'invalid anonymous moderation source' using errcode = '22023';
  end if;
  if char_length(trimmed_reason) not between 5 and 300 then
    raise exception 'reason must contain between 5 and 300 characters' using errcode = '22023';
  end if;
  if p_duration_days is null or p_duration_days not between 1 and 180 then
    raise exception 'duration days must be an integer between 1 and 180' using errcode = '22023';
  end if;

  if p_source_kind = 'post' then
    select post.group_id, author.profile_id into target_group_id, target_profile_id
    from public.posts as post
    join public.groups as group_record on group_record.id = post.group_id
    join private.post_authors as author on author.post_id = post.id
    where post.id = p_source_id and post.kind = 'group'
      and post.author_identity = 'anonymous'
      and post.published_at is not null;
  else
    select post.group_id, author.profile_id into target_group_id, target_profile_id
    from public.post_comments as comment
    join public.posts as post on post.id = comment.post_id and post.kind = 'group'
      and post.published_at is not null
    join public.groups as group_record on group_record.id = post.group_id
    join private.comment_authors as author on author.comment_id = comment.id
    where comment.id = p_source_id and comment.author_identity = 'anonymous'
      and comment.deleted_at is null;
  end if;
  if target_profile_id is null then
    raise exception 'anonymous moderation source not found' using errcode = 'P0002';
  end if;

  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = target_group_id and membership.profile_id = caller_profile_id;
  if caller_role not in ('owner', 'admin') then
    raise exception 'group anonymous moderation is not allowed' using errcode = '42501';
  end if;
  if target_profile_id = caller_profile_id then
    raise exception 'cannot moderate own anonymous activity' using errcode = '42501';
  end if;

  perform private.lock_group_anonymous_activity_target(target_group_id, target_profile_id);
  perform 1 from public.group_memberships as membership
  where membership.group_id = target_group_id and membership.profile_id = target_profile_id
  for update;
  update private.group_anonymous_activity_restrictions as restriction
  set ended_at = restriction.expires_at
  where restriction.group_id = target_group_id and restriction.profile_id = target_profile_id
    and restriction.ended_at is null and restriction.expires_at <= now();
  if exists (
    select 1 from private.group_anonymous_activity_restrictions as restriction
    where restriction.group_id = target_group_id and restriction.profile_id = target_profile_id
      and restriction.ended_at is null and restriction.expires_at > now()
  ) then
    raise exception 'anonymous activity restriction already active' using errcode = '55000';
  end if;

  restriction_expires_at := now() + make_interval(days => p_duration_days);
  insert into private.group_anonymous_activity_restrictions (
    group_id, profile_id, reason, expires_at, restricted_by_profile_id,
    source_kind, source_post_id, source_comment_id
  ) values (
    target_group_id, target_profile_id, trimmed_reason, restriction_expires_at,
    caller_profile_id, p_source_kind,
    case when p_source_kind = 'post' then p_source_id end,
    case when p_source_kind = 'comment' then p_source_id end
  ) returning id into created_restriction_id;
  return query select created_restriction_id, restriction_expires_at;
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
    and profile.deleted_at is null;

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
      and (group_record.kind = 'official' or group_record.join_policy <> 'invite_only')
      and group_record.search_name like '%' || normalized_query || '%'
    order by 5, group_record.name
    limit 5
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_group_post_draft_identity (
  p_post_id         uuid,
  p_author_identity public.post_identity
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_group_id uuid;
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_author_identity is null then
    raise exception 'author identity is required' using errcode = '22023';
  end if;

  select post.group_id into target_group_id
  from public.posts as post
  where post.id = p_post_id
    and post.kind = 'group'
    and post.activity_kind is null
    and post.published_at is null
    and private.is_post_author(post.id);
  if target_group_id is null then
    raise exception 'only the author can change an unpublished group draft identity'
      using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.lock_group_anonymous_activity_target(target_group_id, caller_profile_id);
  end if;

  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = target_group_id
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  perform 1
  from public.posts as post
  where post.id = p_post_id
    and post.kind = 'group'
    and post.group_id = target_group_id
    and post.activity_kind is null
    and post.published_at is null
    and private.is_post_author(post.id)
  for update;
  if not found then
    raise exception 'only the author can change an unpublished group draft identity'
      using errcode = '42501';
  end if;
  if group_posting_policy = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'group posting is restricted to staff' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' and group_identity_policy = 'identified' then
    raise exception 'anonymous posting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.assert_group_anonymous_activity_allowed(target_group_id, caller_profile_id);
  end if;
  if p_author_identity = 'staff' and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;

  perform set_config('app.update_group_post_draft_identity', p_post_id::text, true);
  update public.posts
  set author_identity = p_author_identity,
    display_author_profile_id = case
      when p_author_identity = 'identified' then caller_profile_id
    end
  where id = p_post_id;
  return p_post_id;
end;
$function$;
