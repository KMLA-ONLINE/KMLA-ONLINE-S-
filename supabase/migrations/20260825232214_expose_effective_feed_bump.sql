-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION private.read_post_comments(IN p_comment_ids uuid[], IN p_caller_profile_id bigint, IN p_caller_role public.group_member_role);

DROP FUNCTION public.create_post_comment(IN p_post_id uuid, IN p_body text, IN p_author_identity public.post_identity, IN p_parent_comment_id uuid, IN p_image_id uuid);

DROP FUNCTION public.list_post_comment_replies(IN p_root_comment_id uuid);

DROP FUNCTION public.list_post_comments(IN p_post_id uuid, IN p_cursor_created_at timestamp WITH time zone, IN p_cursor_comment_id uuid, IN p_limit integer);

DROP FUNCTION public.update_post_comment(IN p_comment_id uuid, IN p_body text, IN p_image_id uuid, IN p_remove_image boolean);

CREATE FUNCTION private.read_post_comments (
  p_comment_ids       uuid[],
  p_caller_profile_id bigint,
  p_caller_role       public.group_member_role
)
  RETURNS TABLE (
    comment_id             uuid,
    post_id                uuid,
    parent_comment_id      uuid,
    root_comment_id        uuid,
    depth                  smallint,
    body                   text,
    author_identity        public.post_identity,
    author_pub_id          text,
    author_name            text,
    author_avatar_path     text,
    author_label           text,
    created_at             timestamp with time zone,
    edited_at              timestamp with time zone,
    is_deleted             boolean,
    is_effective_feed_bump boolean,
    is_author              boolean,
    can_edit               boolean,
    can_delete             boolean,
    reply_count            integer,
    reaction_count         integer,
    top_reactions          public.post_reaction[],
    my_reaction            public.post_reaction,
    parent_author_label    text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select
    comment.id,
    comment.post_id,
    comment.parent_comment_id,
    comment.root_comment_id,
    comment.depth,
    -- tombstone은 원문도 작성자도 내보내지 않는다.
    case when comment.deleted_at is null then comment.body else '' end,
    comment.author_identity,
    case
      when comment.deleted_at is null and comment.author_identity in ('identified', 'staff')
      then profile.pub_id
    end,
    case
      when comment.deleted_at is null and comment.author_identity in ('identified', 'staff')
      then profile.name
    end,
    case
      when comment.deleted_at is null and comment.author_identity in ('identified', 'staff')
      then profile.avatar_path
    end,
    case
      when comment.deleted_at is null
      then private.comment_author_label(
        comment.author_identity, comment.anon_alias_number, profile.name
      )
    end,
    comment.created_at,
    comment.edited_at,
    comment.deleted_at is not null,
    feed_bump.comment_id is not null,
    comment.deleted_at is null
      and feed_bump.comment_id is null
      and author.profile_id = p_caller_profile_id,
    comment.deleted_at is null
      and feed_bump.comment_id is null
      and author.profile_id = p_caller_profile_id,
    comment.deleted_at is null
      and feed_bump.comment_id is null
      and (
        author.profile_id = p_caller_profile_id
        or coalesce(p_caller_role in ('owner', 'admin'), false)
      ),
    case
      when comment.depth = 0 then (
        select count(*)::integer
        from public.post_comments as reply
        where reply.root_comment_id = comment.id
          and reply.depth > 0
          and reply.deleted_at is null
      )
      else 0
    end,
    -- 삭제된 댓글에는 반응을 붙일 수 없으므로 tombstone의 요약은 비운다. 지우기 전에 달려 있던
    -- 반응 행은 남아 있지만, 자국만 남은 자리에 남의 반응 수를 보여줄 이유가 없다.
    case when comment.deleted_at is null then summary.total else 0 end,
    case
      when comment.deleted_at is null then summary.top
      else array[]::public.post_reaction[]
    end,
    case when comment.deleted_at is null then mine.reaction end,
    -- 자기 본문과 달리 부모의 이름은 부모가 지워져도 내려보낸다(기능 명세 §9.2).
    case
      when parent.id is not null
      then private.comment_author_label(
        parent.author_identity, parent.anon_alias_number, parent_profile.name
      )
    end
  from public.post_comments as comment
  join private.comment_authors as author on author.comment_id = comment.id
  left join private.feed_bump_events as feed_bump
    on feed_bump.comment_id = comment.id
  left join public.profiles as profile
    on (
      (comment.author_identity = 'identified' and profile.id = comment.display_author_profile_id)
      or (comment.author_identity = 'staff' and profile.id = author.profile_id)
    )
    and profile.status = 'accepted'
    and profile.deleted_at is null
  left join public.comment_reactions as mine
    on mine.comment_id = comment.id and mine.profile_id = p_caller_profile_id
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
      from public.comment_reactions as entry
      where entry.comment_id = comment.id
      group by entry.reaction
    ) as tally
  ) as summary on true
  left join public.post_comments as parent on parent.id = comment.parent_comment_id
  left join private.comment_authors as parent_author on parent_author.comment_id = parent.id
  left join public.profiles as parent_profile
    on (
      (parent.author_identity = 'identified' and parent_profile.id = parent.display_author_profile_id)
      or (parent.author_identity = 'staff' and parent_profile.id = parent_author.profile_id)
    )
    and parent_profile.status = 'accepted'
    and parent_profile.deleted_at is null
  where comment.id = any (p_comment_ids)
  order by comment.created_at, comment.id;
$function$;

REVOKE ALL ON FUNCTION private.read_post_comments(uuid[], bigint, public.group_member_role) FROM PUBLIC;

CREATE FUNCTION public.create_post_comment (
  p_post_id           uuid,
  p_body              text,
  p_author_identity   public.post_identity,
  p_parent_comment_id uuid                 DEFAULT NULL::uuid,
  p_image_id          uuid                 DEFAULT NULL::uuid
)
  RETURNS TABLE (
    comment_id             uuid,
    post_id                uuid,
    parent_comment_id      uuid,
    root_comment_id        uuid,
    depth                  smallint,
    body                   text,
    author_identity        public.post_identity,
    author_pub_id          text,
    author_name            text,
    author_avatar_path     text,
    author_label           text,
    created_at             timestamp with time zone,
    edited_at              timestamp with time zone,
    is_deleted             boolean,
    is_effective_feed_bump boolean,
    is_author              boolean,
    can_edit               boolean,
    can_delete             boolean,
    reply_count            integer,
    reaction_count         integer,
    top_reactions          public.post_reaction[],
    my_reaction            public.post_reaction,
    parent_author_label    text
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
  trimmed_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
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
    and post.deleted_at is null
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
  return query
  select entry.*
  from private.read_post_comments(
    array[new_comment_id], caller_profile_id, context.caller_role
  ) as entry;
end;
$function$;

REVOKE ALL ON FUNCTION public.create_post_comment(uuid, text, public.post_identity, uuid, uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_post_comment(uuid, text, public.post_identity, uuid, uuid) TO authenticated;

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
  if exists (
    select 1
    from private.feed_bump_events as bump
    where bump.comment_id = p_comment_id
  ) then
    raise exception 'effective #업 comments cannot be deleted' using errcode = '22023';
  end if;

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
end;
$function$;

CREATE FUNCTION public.list_post_comment_replies (
  p_root_comment_id uuid
)
  RETURNS TABLE (
    comment_id             uuid,
    post_id                uuid,
    parent_comment_id      uuid,
    root_comment_id        uuid,
    depth                  smallint,
    body                   text,
    author_identity        public.post_identity,
    author_pub_id          text,
    author_name            text,
    author_avatar_path     text,
    author_label           text,
    created_at             timestamp with time zone,
    edited_at              timestamp with time zone,
    is_deleted             boolean,
    is_effective_feed_bump boolean,
    is_author              boolean,
    can_edit               boolean,
    can_delete             boolean,
    reply_count            integer,
    reaction_count         integer,
    top_reactions          public.post_reaction[],
    my_reaction            public.post_reaction,
    parent_author_label    text
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
    comment_id             uuid,
    post_id                uuid,
    parent_comment_id      uuid,
    root_comment_id        uuid,
    depth                  smallint,
    body                   text,
    author_identity        public.post_identity,
    author_pub_id          text,
    author_name            text,
    author_avatar_path     text,
    author_label           text,
    created_at             timestamp with time zone,
    edited_at              timestamp with time zone,
    is_deleted             boolean,
    is_effective_feed_bump boolean,
    is_author              boolean,
    can_edit               boolean,
    can_delete             boolean,
    reply_count            integer,
    reaction_count         integer,
    top_reactions          public.post_reaction[],
    my_reaction            public.post_reaction,
    parent_author_label    text
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

CREATE FUNCTION public.update_post_comment (
  p_comment_id   uuid,
  p_body         text,
  p_image_id     uuid    DEFAULT NULL::uuid,
  p_remove_image boolean DEFAULT false
)
  RETURNS TABLE (
    comment_id             uuid,
    post_id                uuid,
    parent_comment_id      uuid,
    root_comment_id        uuid,
    depth                  smallint,
    body                   text,
    author_identity        public.post_identity,
    author_pub_id          text,
    author_name            text,
    author_avatar_path     text,
    author_label           text,
    created_at             timestamp with time zone,
    edited_at              timestamp with time zone,
    is_deleted             boolean,
    is_effective_feed_bump boolean,
    is_author              boolean,
    can_edit               boolean,
    can_delete             boolean,
    reply_count            integer,
    reaction_count         integer,
    top_reactions          public.post_reaction[],
    my_reaction            public.post_reaction,
    parent_author_label    text
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
    set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
      cleanup_lease_expires_at = null
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

  return query
  select entry.*
  from private.read_post_comments(
    array[p_comment_id], caller_profile_id, context.caller_role
  ) as entry;
end;
$function$;

REVOKE ALL ON FUNCTION public.update_post_comment(uuid, text, uuid, boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.update_post_comment(uuid, text, uuid, boolean) TO authenticated;