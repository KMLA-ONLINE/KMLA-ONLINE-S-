-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.publish_group_post(p_post_id uuid);

DROP FUNCTION public.reorder_post_attachments(p_post_id uuid, p_attachment_ids uuid[]);

CREATE OR REPLACE FUNCTION public.commit_group_post (
  p_post_id         uuid,
  p_title           text,
  p_body            text,
  p_attachment_ids  uuid[],
  p_publish         boolean DEFAULT false,
  p_category_id     uuid    DEFAULT NULL::uuid,
  p_mention_pub_ids text[]  DEFAULT '{}'::text[]
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
  -- 게시 시각을 세운 다음에 부른다. 새 멘션 행의 트리거가 이미 게시된 게시물을 보아야 알림이
  -- 나가기 때문이다. 미게시 초안의 멘션은 `p_publish`가 참인 커밋에서 함께 알린다.
  perform private.sync_post_mentions(p_post_id, coalesce(p_body, ''), p_mention_pub_ids);
  return p_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.notify_post_published()
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
    -- 초안에 멘션을 넣고 나중에 게시하면 멘션 행은 이미 있고 새 INSERT가 없어 트리거가
    -- 돌지 않을 수 있다. 게시되는 이 순간이 그 알림의 유일한 자리다.
    perform private.emit_post_mention_notifications(new.id);
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
