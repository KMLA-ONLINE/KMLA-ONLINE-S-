-- Migration unit 2: after_enum_values
-- Transaction mode: transactional
-- Boundary reason: enum_value_visibility

SET check_function_bodies = false;

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
  )
  select claimed.id, claimed.lease_id, claimed.channel,
    subscription.endpoint, subscription.p256dh, subscription.auth,
    claimed.recipient_email, notification.id,
    notification.importance, notification.category,
    subscription.id,
    notification.title,
    case notification.kind
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
    end,
    case
      when notification.importance = 'high'
        then 'notification:' || notification.id::text
      else 'notification-category:' || notification.category::text || ':' || subscription.id::text
    end
  from claimed
  left join private.web_push_subscriptions as subscription
    on subscription.id = claimed.subscription_id
  left join public.notifications as notification
    on notification.id = claimed.notification_id;
end;
$function$;

CREATE FUNCTION public.commit_group_post (
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
  -- 나가기 때문이다. 미게시 초안의 멘션은 `publish_group_post`가 게시할 때 알린다.
  perform private.sync_post_mentions(p_post_id, coalesce(p_body, ''), p_mention_pub_ids);
  return p_post_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.commit_group_post(uuid, text, text, uuid[], boolean, uuid, text[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.commit_group_post(uuid, text, text, uuid[], boolean, uuid, text[]) TO authenticated;

CREATE FUNCTION public.create_group_post (
  p_group_id        uuid,
  p_title           text,
  p_body            text,
  p_author_identity public.post_identity,
  p_category_id     uuid                 DEFAULT NULL::uuid,
  p_publish         boolean              DEFAULT true,
  p_mention_pub_ids text[]               DEFAULT '{}'::text[]
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
  if p_author_identity = 'anonymous' then
    perform private.lock_group_anonymous_activity_target(
      p_group_id, caller_profile_id
    );
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
    perform private.assert_group_anonymous_activity_allowed(
      p_group_id, caller_profile_id
    );
  end if;
  if p_author_identity = 'staff' and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 100 then
    raise exception 'title must contain between 1 and 100 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(p_body, '')) > 20000 then
    raise exception 'body must contain between 0 and 20000 characters' using errcode = '22023';
  end if;
  if coalesce(p_publish, true) and nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'published post requires a body or ready attachment' using errcode = '22023';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.group_categories as category
    where category.id = p_category_id and category.group_id = p_group_id
  ) then
    raise exception 'category must belong to the group' using errcode = '22023';
  end if;

  insert into public.posts (
    kind, body, group_id, title, category_id, author_identity,
    display_author_profile_id, published_at
  ) values (
    'group', coalesce(p_body, ''), p_group_id, btrim(p_title), p_category_id,
    p_author_identity, case when p_author_identity = 'identified' then caller_profile_id end,
    case when coalesce(p_publish, true) then now() end
  ) returning id into created_post_id;
  insert into private.post_authors (post_id, profile_id)
  values (created_post_id, caller_profile_id);
  -- 즉시 게시 경로도 본문을 직접 쓰므로 여기서 대상을 맞춰야 한다. 이 한 줄이 없으면 화면에는
  -- 멘션이 보이는데 `post_mentions`가 비어 아무도 불리지 않는다.
  perform private.sync_post_mentions(
    created_post_id, coalesce(p_body, ''), p_mention_pub_ids
  );
  return created_post_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.create_group_post(uuid, text, text, public.post_identity, uuid, boolean, text[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_group_post(uuid, text, text, public.post_identity, uuid, boolean, text[]) TO authenticated;

CREATE FUNCTION public.create_post_comment (
  p_post_id           uuid,
  p_body              text,
  p_author_identity   public.post_identity,
  p_parent_comment_id uuid                 DEFAULT NULL::uuid,
  p_image_id          uuid                 DEFAULT NULL::uuid,
  p_mention_pub_ids   text[]               DEFAULT '{}'::text[]
)
  RETURNS TABLE (
    comment_id                              uuid,
    post_id                                 uuid,
    parent_comment_id                       uuid,
    root_comment_id                         uuid,
    depth                                   smallint,
    body                                    text,
    author_identity                         public.post_identity,
    author_pub_id                           text,
    author_name                             text,
    author_avatar_path                      text,
    author_label                            text,
    created_at                              timestamp with time zone,
    edited_at                               timestamp with time zone,
    is_deleted                              boolean,
    is_effective_feed_bump                  boolean,
    is_author                               boolean,
    can_edit                                boolean,
    can_delete                              boolean,
    reply_count                             integer,
    reaction_count                          integer,
    top_reactions                           public.post_reaction[],
    my_reaction                             public.post_reaction,
    parent_author_label                     text,
    can_moderate_anonymous                  boolean,
    anonymous_author_restricted             boolean,
    anonymous_author_restriction_expires_at timestamp with time zone,
    mentions                                jsonb
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  context record;
  parent_record public.post_comments;
  image_record public.comment_images;
  post_author_profile_id bigint;
  new_comment_id uuid := gen_random_uuid();
  new_depth smallint := 0;
  new_root_id uuid;
  new_alias smallint;
  target_group_id uuid;
  trimmed_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' then
    select post.group_id into target_group_id
    from public.posts as post
    where post.id = p_post_id and post.kind = 'group';
    if target_group_id is not null then
      perform private.lock_group_anonymous_activity_target(
        target_group_id, caller_profile_id
      );
    end if;
  end if;
  perform 1
  from public.posts as post
  join public.groups as group_data on group_data.id = post.group_id
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where post.id = p_post_id and post.kind = 'group'
  for share of group_data, membership;
  perform 1
  from public.posts as post
  where post.id = p_post_id
    and post.published_at is not null
  for update;
  if not found then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  context := private.comment_post_context(p_post_id, caller_profile_id);
  if context.post_kind is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if not context.is_visible then
    raise exception 'post is not accessible' using errcode = '42501';
  end if;
  if context.post_kind = 'profile' then
    if p_author_identity <> 'identified' then
      raise exception 'profile post comments must be identified' using errcode = '42501';
    end if;
  else
    if p_author_identity = 'anonymous' and context.identity_policy = 'identified' then
      raise exception 'anonymous commenting is not allowed' using errcode = '42501';
    end if;
    if p_author_identity = 'anonymous' then
      perform private.assert_group_anonymous_activity_allowed(
        target_group_id, caller_profile_id
      );
    end if;
    if p_author_identity = 'staff'
      and context.caller_role not in ('owner', 'admin', 'manager') then
      raise exception 'staff identity is not allowed' using errcode = '42501';
    end if;
  end if;
  if char_length(trimmed_body) > 5000 then
    raise exception 'comment must contain between 1 and 5000 characters' using errcode = '22023';
  end if;
  if trimmed_body = '' and p_image_id is null then
    raise exception 'comment requires a body or finalized image' using errcode = '22023';
  end if;
  if p_parent_comment_id is not null then
    select parent.* into parent_record
    from public.post_comments as parent
    where parent.id = p_parent_comment_id and parent.deleted_at is null
    for update;
    if parent_record.id is null then
      raise exception 'parent comment not found' using errcode = 'P0002';
    end if;
    if parent_record.post_id <> p_post_id then
      raise exception 'parent comment must belong to the post' using errcode = '22023';
    end if;
    if parent_record.depth >= 10 then
      raise exception 'replies cannot nest deeper than 10 levels' using errcode = '22023';
    end if;
    new_depth := (parent_record.depth + 1)::smallint;
    new_root_id := parent_record.root_comment_id;
  else
    new_root_id := new_comment_id;
  end if;
  if p_image_id is not null then
    select image.* into image_record
    from public.comment_images as image
    where image.id = p_image_id
    for update;
    if image_record.id is null or image_record.post_id <> p_post_id
      or image_record.status <> 'finalized' or image_record.comment_id is not null
      or not private.is_comment_image_uploader(p_image_id) then
      raise exception 'finalized comment image is not claimable' using errcode = '42501';
    end if;
  end if;
  if p_author_identity = 'anonymous' then
    select author.profile_id into post_author_profile_id
    from private.post_authors as author
    where author.post_id = p_post_id;
    if context.post_author_identity = 'anonymous'
      and post_author_profile_id = caller_profile_id then
      new_alias := 0;
    else
      select alias.alias_number into new_alias
      from private.post_anonymous_aliases as alias
      where alias.post_id = p_post_id and alias.profile_id = caller_profile_id;
      if new_alias is null then
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(p_post_id::text, 0)
        );
        select alias.alias_number into new_alias
        from private.post_anonymous_aliases as alias
        where alias.post_id = p_post_id and alias.profile_id = caller_profile_id;
        if new_alias is null then
          select coalesce(max(alias.alias_number), 0) + 1 into new_alias
          from private.post_anonymous_aliases as alias
          where alias.post_id = p_post_id;
          insert into private.post_anonymous_aliases (post_id, profile_id, alias_number)
          values (p_post_id, caller_profile_id, new_alias);
        end if;
      end if;
    end if;
  end if;

  insert into public.post_comments (
    id, post_id, parent_comment_id, root_comment_id, depth, body,
    author_identity, display_author_profile_id, anon_alias_number
  ) values (
    new_comment_id, p_post_id, p_parent_comment_id, new_root_id, new_depth, trimmed_body,
    p_author_identity, case when p_author_identity = 'identified' then caller_profile_id end,
    new_alias
  );
  insert into private.comment_authors (comment_id, profile_id)
  values (new_comment_id, caller_profile_id);
  if p_image_id is not null then
    update public.comment_images
    set comment_id = new_comment_id, status = 'ready', ready_at = now()
    where id = p_image_id;
  end if;
  perform private.sync_comment_mentions(
    new_comment_id, trimmed_body, p_author_identity, p_mention_pub_ids
  );
  return query
  select entry.*
  from private.read_post_comments(
    array[new_comment_id], caller_profile_id, context.caller_role
  ) as entry;
end;
$function$;

REVOKE ALL ON FUNCTION public.create_post_comment(uuid, text, public.post_identity, uuid, uuid, text[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_post_comment(uuid, text, public.post_identity, uuid, uuid, text[]) TO authenticated;

CREATE FUNCTION public.get_group_post (
  p_post_id uuid
)
  RETURNS TABLE (
    post_id                                 uuid,
    group_id                                uuid,
    category_id                             uuid,
    category_name                           text,
    title                                   text,
    body                                    text,
    author_identity                         public.post_identity,
    author_pub_id                           text,
    author_name                             text,
    author_avatar_path                      text,
    author_label                            text,
    is_pinned                               boolean,
    published_at                            timestamp with time zone,
    edited_at                               timestamp with time zone,
    comment_count                           integer,
    reaction_count                          integer,
    top_reactions                           public.post_reaction[],
    my_reaction                             public.post_reaction,
    is_author                               boolean,
    can_edit                                boolean,
    can_delete                              boolean,
    can_pin                                 boolean,
    can_moderate_anonymous                  boolean,
    anonymous_author_restricted             boolean,
    anonymous_author_restriction_expires_at timestamp with time zone,
    mentions                                jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_group_id uuid;
  caller_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.group_id into post_group_id
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
    and post.published_at is not null;
  if post_group_id is null then
    return;
  end if;
  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = post_group_id
    and membership.profile_id = caller_profile_id;
  if caller_role is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select
    post.id, post.group_id, post.category_id, category.name,
    post.title, post.body, post.author_identity,
    case when post.author_identity in ('identified', 'staff') then profile.pub_id end,
    case when post.author_identity in ('identified', 'staff') then profile.name end,
    case when post.author_identity in ('identified', 'staff') then profile.avatar_path end,
    case post.author_identity
      when 'identified' then profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    post.pinned_at is not null, post.published_at, post.edited_at,
    post.comment_count,
    summary.total,
    summary.top,
    mine.reaction,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id or caller_role in ('owner', 'admin'),
    caller_role in ('owner', 'admin', 'manager'),
    post.author_identity = 'anonymous' and author.profile_id <> caller_profile_id
      and caller_role in ('owner', 'admin'),
    active_restriction.expires_at is not null,
    active_restriction.expires_at,
    private.post_mentions_json(post.id)
  from public.posts as post
  join private.post_authors as author on author.post_id = post.id
  left join public.group_categories as category on category.id = post.category_id
  left join public.profiles as profile
    on (
      (post.author_identity = 'identified' and profile.id = post.display_author_profile_id)
      or (post.author_identity = 'staff' and profile.id = author.profile_id)
    )
    and profile.status = 'accepted'
    and profile.deleted_at is null
  left join public.post_reactions as mine
    on mine.post_id = post.id and mine.profile_id = caller_profile_id
  left join lateral (
    select restriction.expires_at
    from private.group_anonymous_activity_restrictions as restriction
    where restriction.group_id = post.group_id
      and restriction.profile_id = author.profile_id
      and restriction.ended_at is null
      and restriction.expires_at > now()
    order by restriction.created_at desc, restriction.id desc
    limit 1
  ) as active_restriction on post.author_identity = 'anonymous'
    and author.profile_id <> caller_profile_id
    and caller_role in ('owner', 'admin')
  left join lateral (
    select
      coalesce(sum(tally.n)::integer, 0) as total,
      coalesce(
        array_agg(tally.reaction order by tally.n desc, tally.reaction)
          filter (where tally.rank <= 3),
        array[]::public.post_reaction[]
      ) as top
    from (
      select
        entry.reaction,
        count(*)::integer as n,
        row_number() over (order by count(*) desc, entry.reaction) as rank
      from public.post_reactions as entry
      where entry.post_id = post.id
      group by entry.reaction
    ) as tally
  ) as summary on true
  where post.id = p_post_id and post.kind = 'group'
    and post.published_at is not null;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_group_post(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_group_post(uuid) TO authenticated;

CREATE FUNCTION public.list_feed_posts (
  p_page_token uuid DEFAULT NULL::uuid
)
  RETURNS TABLE (
    feed_epoch          timestamp with time zone,
    next_page_token     uuid,
    feed_position       integer,
    rank_time           timestamp with time zone,
    post_id             uuid,
    kind                public.post_kind,
    body                text,
    title               text,
    author_identity     public.post_identity,
    author_pub_id       text,
    author_name         text,
    author_avatar_path  text,
    author_label        text,
    group_id            uuid,
    group_slug          text,
    group_name          text,
    category_name       text,
    is_pinned           boolean,
    timeline_pub_id     text,
    timeline_name       text,
    activity_kind       public.profile_media_activity_kind,
    activity_media_path text,
    visibility          public.post_visibility,
    published_at        timestamp with time zone,
    edited_at           timestamp with time zone,
    comment_count       integer,
    reaction_count      integer,
    top_reactions       public.post_reaction[],
    my_reaction         public.post_reaction,
    attachments         jsonb,
    is_author           boolean,
    mentions            jsonb
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_session_id uuid;
  target_epoch timestamptz;
  page_after_position integer := 0;
  page_last_position integer;
  following_page_token uuid;
  selected_positions integer[];
  selected_post_ids uuid[];
  selected_rank_times timestamptz[];
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_page_token is null then
    target_session_id := private.create_feed_session(caller_profile_id);
    select session.feed_epoch into target_epoch
    from private.feed_sessions as session
    where session.id = target_session_id;
  else
    select page.session_id, page.after_position, session.feed_epoch
    into target_session_id, page_after_position, target_epoch
    from private.feed_pages as page
    join private.feed_sessions as session on session.id = page.session_id
    where page.token = p_page_token
      and session.profile_id = caller_profile_id
      and session.expires_at > statement_timestamp();

    if target_session_id is null then
      raise exception 'feed page not found or expired' using errcode = '22023';
    end if;
  end if;

  select
    array_agg(page.position order by page.position),
    array_agg(page.post_id order by page.position),
    array_agg(page.rank_time order by page.position)
  into selected_positions, selected_post_ids, selected_rank_times
  from (
    select entry.position, entry.post_id, entry.rank_time
    from private.feed_session_posts as entry
    where entry.session_id = target_session_id
      and entry.position > page_after_position
      and private.can_access_feed_post(entry.post_id, caller_profile_id)
    order by entry.position
    limit 20
  ) as page;

  if cardinality(selected_positions) > 0 then
    page_last_position := selected_positions[cardinality(selected_positions)];
  end if;

  if page_last_position is not null and exists (
    select 1
    from private.feed_session_posts as entry
    where entry.session_id = target_session_id
      and entry.position > page_last_position
      and private.can_access_feed_post(entry.post_id, caller_profile_id)
  ) then
    insert into private.feed_pages (session_id, after_position)
    values (target_session_id, page_last_position)
    on conflict (session_id, after_position) do nothing;

    select page.token into following_page_token
    from private.feed_pages as page
    where page.session_id = target_session_id
      and page.after_position = page_last_position;
  end if;

  return query
  select
    target_epoch,
    following_page_token,
    selected.position,
    selected.rank_time,
    post.id,
    post.kind,
    post.body,
    post.title,
    post.author_identity,
    case when post.author_identity in ('identified', 'staff') then author_profile.pub_id end,
    case when post.author_identity in ('identified', 'staff') then author_profile.name end,
    case when post.author_identity in ('identified', 'staff') then author_profile.avatar_path end,
    case post.author_identity
      when 'identified' then author_profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    post.group_id,
    group_record.slug,
    group_record.name,
    category.name,
    post.pinned_at is not null,
    timeline.pub_id,
    timeline.name,
    post.activity_kind,
    post.activity_media_path,
    post.visibility,
    post.published_at,
    post.edited_at,
    post.comment_count,
    reaction_summary.total,
    reaction_summary.top,
    mine.reaction,
    attachment_summary.items,
    author.profile_id = caller_profile_id,
    private.post_mentions_json(post.id)
  from unnest(selected_positions, selected_post_ids, selected_rank_times)
    as selected(position, post_id, rank_time)
  join public.posts as post on post.id = selected.post_id
  join private.post_authors as author on author.post_id = post.id
  left join public.profiles as author_profile
    on (
      (post.author_identity = 'identified' and author_profile.id = post.display_author_profile_id)
      or (post.author_identity = 'staff' and author_profile.id = author.profile_id)
    )
    and author_profile.status = 'accepted'
    and author_profile.deleted_at is null
  left join public.groups as group_record on group_record.id = post.group_id
  left join public.group_categories as category on category.id = post.category_id
  left join public.profiles as timeline
    on timeline.id = post.timeline_profile_id
    and timeline.status = 'accepted'
    and timeline.deleted_at is null
  left join public.post_reactions as mine
    on mine.post_id = post.id and mine.profile_id = caller_profile_id
  left join lateral (
    select
      coalesce(sum(tally.n), 0)::integer as total,
      coalesce(
        array_agg(tally.reaction order by tally.n desc, tally.reaction)
          filter (where tally.rank <= 3),
        array[]::public.post_reaction[]
      ) as top
    from (
      select entry.reaction, count(*)::integer as n,
        row_number() over (order by count(*) desc, entry.reaction) as rank
      from public.post_reactions as entry
      where entry.post_id = post.id
      group by entry.reaction
    ) as tally
  ) as reaction_summary on true
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'attachment_id', attachment.id,
          'storage_bucket', attachment.storage_bucket,
          'object_path', attachment.object_path,
          'original_filename', attachment.original_filename,
          'position', attachment.position,
          'mime_type', attachment.mime_type,
          'size_bytes', attachment.size_bytes,
          'width', attachment.width,
          'height', attachment.height
        ) order by attachment.position, attachment.id
      ),
      '[]'::jsonb
    ) as items
    from public.post_attachments as attachment
    where attachment.post_id = post.id and attachment.status = 'ready'
  ) as attachment_summary on true
  order by selected.position;
end;
$function$;

REVOKE ALL ON FUNCTION public.list_feed_posts(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_feed_posts(uuid) TO authenticated;

CREATE FUNCTION public.list_group_posts (
  p_group_id            uuid,
  p_category_id         uuid                     DEFAULT NULL::uuid,
  p_cursor_published_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_cursor_post_id      uuid                     DEFAULT NULL::uuid,
  p_cursor_is_pinned    boolean                  DEFAULT NULL::boolean,
  p_limit               integer                  DEFAULT 20
)
  RETURNS TABLE (
    post_id                                 uuid,
    group_id                                uuid,
    category_id                             uuid,
    category_name                           text,
    title                                   text,
    body                                    text,
    author_identity                         public.post_identity,
    author_pub_id                           text,
    author_name                             text,
    author_avatar_path                      text,
    author_label                            text,
    is_pinned                               boolean,
    published_at                            timestamp with time zone,
    edited_at                               timestamp with time zone,
    comment_count                           integer,
    reaction_count                          integer,
    top_reactions                           public.post_reaction[],
    my_reaction                             public.post_reaction,
    is_author                               boolean,
    can_edit                                boolean,
    can_delete                              boolean,
    can_pin                                 boolean,
    can_moderate_anonymous                  boolean,
    anonymous_author_restricted             boolean,
    anonymous_author_restriction_expires_at timestamp with time zone,
    mentions                                jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  caller_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if (p_cursor_published_at is null) <> (p_cursor_post_id is null)
    or (p_cursor_post_id is null) <> (p_cursor_is_pinned is null) then
    raise exception 'post cursor must be complete' using errcode = '22023';
  end if;
  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id;
  if caller_role is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select
    post.id, post.group_id, post.category_id, category.name,
    post.title, post.body, post.author_identity,
    case when post.author_identity in ('identified', 'staff') then profile.pub_id end,
    case when post.author_identity in ('identified', 'staff') then profile.name end,
    case when post.author_identity in ('identified', 'staff') then profile.avatar_path end,
    case post.author_identity
      when 'identified' then profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    post.pinned_at is not null, post.published_at, post.edited_at,
    post.comment_count,
    summary.total,
    summary.top,
    mine.reaction,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id or caller_role in ('owner', 'admin'),
    caller_role in ('owner', 'admin', 'manager'),
    post.author_identity = 'anonymous' and author.profile_id <> caller_profile_id
      and caller_role in ('owner', 'admin'),
    active_restriction.expires_at is not null,
    active_restriction.expires_at,
    private.post_mentions_json(post.id)
  from public.posts as post
  join private.post_authors as author on author.post_id = post.id
  left join public.group_categories as category on category.id = post.category_id
  left join public.profiles as profile
    on (
      (post.author_identity = 'identified' and profile.id = post.display_author_profile_id)
      or (post.author_identity = 'staff' and profile.id = author.profile_id)
    )
    and profile.status = 'accepted'
    and profile.deleted_at is null
  left join public.post_reactions as mine
    on mine.post_id = post.id and mine.profile_id = caller_profile_id
  left join lateral (
    select restriction.expires_at
    from private.group_anonymous_activity_restrictions as restriction
    where restriction.group_id = post.group_id
      and restriction.profile_id = author.profile_id
      and restriction.ended_at is null
      and restriction.expires_at > now()
    order by restriction.created_at desc, restriction.id desc
    limit 1
  ) as active_restriction on post.author_identity = 'anonymous'
    and author.profile_id <> caller_profile_id
    and caller_role in ('owner', 'admin')
  left join lateral (
    select
      coalesce(sum(tally.n)::integer, 0) as total,
      coalesce(
        array_agg(tally.reaction order by tally.n desc, tally.reaction)
          filter (where tally.rank <= 3),
        array[]::public.post_reaction[]
      ) as top
    from (
      select
        entry.reaction,
        count(*)::integer as n,
        row_number() over (order by count(*) desc, entry.reaction) as rank
      from public.post_reactions as entry
      where entry.post_id = post.id
      group by entry.reaction
    ) as tally
  ) as summary on true
  where post.group_id = p_group_id and post.kind = 'group'
    and post.published_at is not null
    and (p_category_id is null or post.category_id = p_category_id)
    and (
      p_cursor_post_id is null
      or (
        p_cursor_is_pinned
        and (
          post.pinned_at is null
          or (
            post.pinned_at is not null
            and (post.published_at, post.id) < (p_cursor_published_at, p_cursor_post_id)
          )
        )
      )
      or (
        not p_cursor_is_pinned
        and post.pinned_at is null
        and (post.published_at, post.id) < (p_cursor_published_at, p_cursor_post_id)
      )
    )
  order by (post.pinned_at is not null) desc, post.published_at desc, post.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$function$;

REVOKE ALL ON FUNCTION public.list_group_posts(uuid, uuid, timestamp WITH time zone, uuid, boolean, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_group_posts(uuid, uuid, timestamp WITH time zone, uuid, boolean, integer) TO authenticated;

CREATE FUNCTION public.list_post_comment_replies (
  p_root_comment_id uuid
)
  RETURNS TABLE (
    comment_id                              uuid,
    post_id                                 uuid,
    parent_comment_id                       uuid,
    root_comment_id                         uuid,
    depth                                   smallint,
    body                                    text,
    author_identity                         public.post_identity,
    author_pub_id                           text,
    author_name                             text,
    author_avatar_path                      text,
    author_label                            text,
    created_at                              timestamp with time zone,
    edited_at                               timestamp with time zone,
    is_deleted                              boolean,
    is_effective_feed_bump                  boolean,
    is_author                               boolean,
    can_edit                                boolean,
    can_delete                              boolean,
    reply_count                             integer,
    reaction_count                          integer,
    top_reactions                           public.post_reaction[],
    my_reaction                             public.post_reaction,
    parent_author_label                     text,
    can_moderate_anonymous                  boolean,
    anonymous_author_restricted             boolean,
    anonymous_author_restriction_expires_at timestamp with time zone,
    mentions                                jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  root_post_id uuid;
  context record;
  visible_ids uuid[];
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select comment.post_id into root_post_id
  from public.post_comments as comment
  where comment.id = p_root_comment_id
    and comment.depth = 0
    and comment.deleted_at is null;
  if root_post_id is null then
    return;
  end if;

  context := private.comment_post_context(root_post_id, caller_profile_id);
  if not context.is_visible then
    return;
  end if;

  -- 삭제된 답글은 살아 있는 자손이 있을 때만 `삭제된 댓글입니다`로 남긴다(기능 명세 §9.4).
  -- 살아 있는 노드에서 부모를 따라 올라가며 표시해야 할 조상을 모은다.
  with recursive subtree as (
    select comment.id, comment.parent_comment_id, comment.deleted_at, comment.depth
    from public.post_comments as comment
    where comment.root_comment_id = p_root_comment_id
  ),
  live_ancestor as (
    select node.parent_comment_id as id
    from subtree as node
    where node.deleted_at is null and node.parent_comment_id is not null
    union
    select node.parent_comment_id
    from live_ancestor as walked
    join subtree as node on node.id = walked.id
    where node.parent_comment_id is not null
  )
  select array_agg(node.id) into visible_ids
  from subtree as node
  where node.depth > 0
    and (
      node.deleted_at is null
      or node.id in (select ancestor.id from live_ancestor as ancestor)
    );

  return query
  select entry.*
  from private.read_post_comments(
    coalesce(visible_ids, '{}'::uuid[]), caller_profile_id, context.caller_role
  ) as entry;
end;
$function$;

REVOKE ALL ON FUNCTION public.list_post_comment_replies(uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_post_comment_replies(uuid) TO authenticated;

CREATE FUNCTION public.list_post_comments (
  p_post_id           uuid,
  p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_cursor_comment_id uuid                     DEFAULT NULL::uuid,
  p_limit             integer                  DEFAULT 20
)
  RETURNS TABLE (
    comment_id                              uuid,
    post_id                                 uuid,
    parent_comment_id                       uuid,
    root_comment_id                         uuid,
    depth                                   smallint,
    body                                    text,
    author_identity                         public.post_identity,
    author_pub_id                           text,
    author_name                             text,
    author_avatar_path                      text,
    author_label                            text,
    created_at                              timestamp with time zone,
    edited_at                               timestamp with time zone,
    is_deleted                              boolean,
    is_effective_feed_bump                  boolean,
    is_author                               boolean,
    can_edit                                boolean,
    can_delete                              boolean,
    reply_count                             integer,
    reaction_count                          integer,
    top_reactions                           public.post_reaction[],
    my_reaction                             public.post_reaction,
    parent_author_label                     text,
    can_moderate_anonymous                  boolean,
    anonymous_author_restricted             boolean,
    anonymous_author_restriction_expires_at timestamp with time zone,
    mentions                                jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  context record;
  page_ids uuid[];
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_comment_id is null) then
    raise exception 'comment cursor must be complete' using errcode = '22023';
  end if;

  context := private.comment_post_context(p_post_id, caller_profile_id);
  if not context.is_visible then
    return;
  end if;

  -- 대화를 처음부터 읽을 수 있도록 오래된 최상위 댓글부터 고르고, 커서 뒤의 새 댓글을 잇는다.
  -- 최상위 댓글을 지우면 자손까지 함께 삭제되므로 여기서는 살아 있는 행만 보면 된다.
  select array_agg(page.id order by page.created_at, page.id) into page_ids
  from (
    select comment.id, comment.created_at
    from public.post_comments as comment
    where comment.post_id = p_post_id
      and comment.depth = 0
      and comment.deleted_at is null
      and (
        p_cursor_comment_id is null
        or (comment.created_at, comment.id) > (p_cursor_created_at, p_cursor_comment_id)
      )
    order by comment.created_at, comment.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) as page;

  return query
  select entry.*
  from private.read_post_comments(
    coalesce(page_ids, '{}'::uuid[]), caller_profile_id, context.caller_role
  ) as entry;
end;
$function$;

REVOKE ALL ON FUNCTION public.list_post_comments(uuid, timestamp WITH time zone, uuid, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_post_comments(uuid, timestamp WITH time zone, uuid, integer) TO authenticated;

CREATE FUNCTION public.search_group_mention_candidates (
  p_group_id uuid,
  p_query    text    DEFAULT ''::text,
  p_limit    integer DEFAULT 30
)
  RETURNS TABLE (
    pub_id               text,
    name                 text,
    cohort               smallint,
    is_returning_student boolean,
    profile_type         public.profile_type,
    avatar_path          text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  query_text text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 50 then
    raise exception 'mention candidate limit must be between 1 and 50' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
  ) then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select profile.pub_id, profile.name, profile.cohort,
    profile.is_returning_student, profile.type, profile.avatar_path
  from public.group_memberships as membership
  join public.profiles as profile on profile.id = membership.profile_id
  where membership.group_id = p_group_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and (
      query_text = ''
      or profile.name ilike '%' || query_text || '%'
      -- 명부와 같은 규칙으로 표시값을 검색한다. 복학생은 n.5기로 보이므로 '20'이 20기와
      -- 20.5기를 함께 찾는다.
      or (
        profile.cohort + case when profile.is_returning_student then 0.5 else 0 end
      )::text like '%' || query_text || '%'
      -- 선생님은 기수가 없어 화면에 '선생님'으로 나온다. 보이는 대로 검색되어야 한다.
      or (profile.type = 'teacher' and '선생님' like '%' || query_text || '%')
    )
  order by
    case when profile.type = 'teacher' then 0 else 1 end,
    (profile.cohort + case when profile.is_returning_student then 0.5 else 0 end)
      desc nulls last,
    profile.name,
    profile.id
  limit p_limit;
end;
$function$;

REVOKE ALL ON FUNCTION public.search_group_mention_candidates(uuid, text, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.search_group_mention_candidates(uuid, text, integer) TO authenticated;

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
  -- 익명은 멘션할 수 없다(기능 명세 §8.14). 멘션을 넣어 둔 초안을 익명으로 바꾸는 길을 열어
  -- 두면 그 금지가 통째로 우회된다. 본문에서 멘션을 지운 뒤 다시 바꾸게 한다.
  if p_author_identity = 'anonymous' and exists (
    select 1 from public.post_mentions as mention where mention.post_id = p_post_id
  ) then
    raise exception 'remove mentions before switching a draft to anonymous'
      using errcode = '22023';
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

CREATE FUNCTION public.update_post_comment (
  p_comment_id      uuid,
  p_body            text,
  p_image_id        uuid    DEFAULT NULL::uuid,
  p_remove_image    boolean DEFAULT false,
  p_mention_pub_ids text[]  DEFAULT '{}'::text[]
)
  RETURNS TABLE (
    comment_id                              uuid,
    post_id                                 uuid,
    parent_comment_id                       uuid,
    root_comment_id                         uuid,
    depth                                   smallint,
    body                                    text,
    author_identity                         public.post_identity,
    author_pub_id                           text,
    author_name                             text,
    author_avatar_path                      text,
    author_label                            text,
    created_at                              timestamp with time zone,
    edited_at                               timestamp with time zone,
    is_deleted                              boolean,
    is_effective_feed_bump                  boolean,
    is_author                               boolean,
    can_edit                                boolean,
    can_delete                              boolean,
    reply_count                             integer,
    reaction_count                          integer,
    top_reactions                           public.post_reaction[],
    my_reaction                             public.post_reaction,
    parent_author_label                     text,
    can_moderate_anonymous                  boolean,
    anonymous_author_restricted             boolean,
    anonymous_author_restriction_expires_at timestamp with time zone,
    mentions                                jsonb
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  comment_record public.post_comments;
  current_image public.comment_images;
  next_image public.comment_images;
  context record;
  trimmed_body text := btrim(coalesce(p_body, ''));
  image_changed boolean;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select comment.* into comment_record
  from public.post_comments as comment
  where comment.id = p_comment_id and comment.deleted_at is null
  for update;
  if comment_record.id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from private.comment_authors as author
    where author.comment_id = p_comment_id and author.profile_id = caller_profile_id
  ) then
    raise exception 'only the author can edit a comment' using errcode = '42501';
  end if;
  if exists (
    select 1
    from private.feed_bump_events as bump
    where bump.comment_id = p_comment_id
  ) then
    raise exception 'effective #업 comments cannot be edited' using errcode = '22023';
  end if;

  context := private.comment_post_context(comment_record.post_id, caller_profile_id);
  if not context.is_visible then
    raise exception 'post is not accessible' using errcode = '42501';
  end if;
  if char_length(trimmed_body) > 5000 then
    raise exception 'comment must contain between 1 and 5000 characters' using errcode = '22023';
  end if;
  if coalesce(p_remove_image, false) and p_image_id is not null then
    raise exception 'cannot replace and remove a comment image together' using errcode = '22023';
  end if;

  select image.* into current_image
  from public.comment_images as image
  where image.comment_id = p_comment_id and image.status = 'ready'
  for update;
  if trimmed_body = ''
    and p_image_id is null
    and (coalesce(p_remove_image, false) or current_image.id is null) then
    raise exception 'comment requires a body or finalized image' using errcode = '22023';
  end if;
  image_changed := case
    when coalesce(p_remove_image, false) then current_image.id is not null
    when p_image_id is null then false
    else current_image.id is distinct from p_image_id
  end;

  if p_image_id is not null and image_changed then
    select image.* into next_image
    from public.comment_images as image
    where image.id = p_image_id
    for update;
    if next_image.id is null
      or next_image.post_id <> comment_record.post_id
      or next_image.status <> 'finalized'
      or next_image.comment_id is not null
      or not private.is_comment_image_uploader(p_image_id) then
      raise exception 'finalized comment image is not claimable' using errcode = '42501';
    end if;
  end if;

  if image_changed and current_image.id is not null then
    update public.comment_images
    set status = 'deleted', deleted_at = now()
    where id = current_image.id;
  end if;
  if p_image_id is not null and image_changed then
    update public.comment_images
    set comment_id = p_comment_id, status = 'ready', ready_at = now()
    where id = p_image_id;
  end if;

  update public.post_comments as comment
  set body = trimmed_body,
    edited_at = case
      when comment_record.body is distinct from trimmed_body or image_changed then now()
      else comment_record.edited_at
    end
  where comment.id = p_comment_id;
  -- 작성 신원은 등록 뒤 바꿀 수 없으므로(기능 명세 §8.5) 저장된 값을 그대로 넘긴다.
  perform private.sync_comment_mentions(
    p_comment_id, trimmed_body, comment_record.author_identity, p_mention_pub_ids
  );

  return query
  select entry.*
  from private.read_post_comments(
    array[p_comment_id], caller_profile_id, context.caller_role
  ) as entry;
end;
$function$;

REVOKE ALL ON FUNCTION public.update_post_comment(uuid, text, uuid, boolean, text[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.update_post_comment(uuid, text, uuid, boolean, text[]) TO authenticated;

CREATE TABLE public.comment_mentions (
  comment_id uuid     NOT NULL,
  ordinal    smallint NOT NULL,
  profile_id bigint   NOT NULL
);

ALTER TABLE public.comment_mentions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.comment_mentions
  ADD CONSTRAINT comment_mentions_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.post_comments(id) ON DELETE CASCADE;

ALTER TABLE public.comment_mentions
  ADD CONSTRAINT comment_mentions_ordinal_range CHECK (ordinal >= 1 AND ordinal <= 10);

ALTER TABLE public.comment_mentions
  ADD CONSTRAINT comment_mentions_pkey PRIMARY KEY (comment_id, ordinal);

ALTER TABLE public.comment_mentions
  ADD CONSTRAINT comment_mentions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.comment_mentions FROM anon, authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.comment_mentions TO service_role;

CREATE UNIQUE INDEX comment_mentions_target_idx ON public.comment_mentions (comment_id, profile_id);

CREATE TRIGGER comment_mentions_notify_created
  AFTER INSERT ON public.comment_mentions
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_comment_mention();

CREATE POLICY comment_mentions_deny_client_access ON public.comment_mentions
  USING (false)
  WITH CHECK (false);

CREATE TABLE public.post_mentions (
  post_id    uuid     NOT NULL,
  ordinal    smallint NOT NULL,
  profile_id bigint   NOT NULL
);

ALTER TABLE public.post_mentions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.post_mentions
  ADD CONSTRAINT post_mentions_ordinal_range CHECK (ordinal >= 1 AND ordinal <= 10);

ALTER TABLE public.post_mentions
  ADD CONSTRAINT post_mentions_pkey PRIMARY KEY (post_id, ordinal);

ALTER TABLE public.post_mentions
  ADD CONSTRAINT post_mentions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;

ALTER TABLE public.post_mentions
  ADD CONSTRAINT post_mentions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.post_mentions FROM anon, authenticated;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.post_mentions TO service_role;

CREATE UNIQUE INDEX post_mentions_target_idx ON public.post_mentions (post_id, profile_id);

CREATE TRIGGER post_mentions_notify_created
  AFTER INSERT ON public.post_mentions
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_post_mention();

CREATE POLICY post_mentions_deny_client_access ON public.post_mentions
  USING (false)
  WITH CHECK (false);
