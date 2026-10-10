SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.post_attachments_json (
  p_post_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'attachment_id', attachment.id,
        'storage_bucket', attachment.storage_bucket,
        'object_path', attachment.object_path,
        'thumbnail_path', attachment.thumbnail_path,
        'original_filename', attachment.original_filename,
        'position', attachment.position,
        'mime_type', attachment.mime_type,
        'size_bytes', attachment.size_bytes,
        'width', attachment.width,
        'height', attachment.height
      )
      order by attachment.position, attachment.id
    ),
    '[]'::jsonb
  )
  from public.post_attachments as attachment
  where attachment.post_id = p_post_id and attachment.status = 'ready';
$function$;

CREATE OR REPLACE FUNCTION public.list_feed_posts (
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
  selected_positions integer[] := '{}'::integer[];
  selected_post_ids uuid[] := '{}'::uuid[];
  selected_rank_times timestamptz[] := '{}'::timestamptz[];
  has_more boolean := false;
  session_entry record;
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

  -- 위치 순으로 읽다가 접근 가능한 20개와, 다음 페이지가 있는지 알려 줄 하나를 더 찾으면 멈춘다.
  -- 같은 일을 `order by ... limit 20` 한 문장으로 쓰면 planner가 세션 전체에 접근 검사를 돌린 뒤
  -- 정렬하는 계획을 고를 수 있다. 세션은 접근 가능한 게시물 전부를 담으므로 그 비용이 페이지마다 든다.
  for session_entry in
    select entry.position, entry.post_id, entry.rank_time
    from private.feed_session_posts as entry
    where entry.session_id = target_session_id
      and entry.position > page_after_position
    order by entry.position
  loop
    continue when not private.can_access_feed_post(session_entry.post_id, caller_profile_id);

    if cardinality(selected_positions) = 20 then
      has_more := true;
      exit;
    end if;

    selected_positions := selected_positions || session_entry.position;
    selected_post_ids := selected_post_ids || session_entry.post_id;
    selected_rank_times := selected_rank_times || session_entry.rank_time;
  end loop;

  if has_more then
    page_last_position := selected_positions[cardinality(selected_positions)];

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
    private.post_attachments_json(post.id),
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
  order by selected.position;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_group_posts (
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
    mentions                                jsonb,
    attachments                             jsonb
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
    private.post_mentions_json(post.id),
    private.post_attachments_json(post.id)
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

CREATE OR REPLACE FUNCTION public.list_profile_posts (
  p_timeline_pub_id     text,
  p_cursor_published_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_cursor_post_id      uuid                     DEFAULT NULL::uuid,
  p_limit               integer                  DEFAULT 20
)
  RETURNS TABLE (
    post_id             uuid,
    body                text,
    timeline_pub_id     text,
    timeline_name       text,
    author_pub_id       text,
    author_name         text,
    author_avatar_path  text,
    activity_kind       public.profile_media_activity_kind,
    activity_media_path text,
    visibility          public.post_visibility,
    published_at        timestamp with time zone,
    edited_at           timestamp with time zone,
    comment_count       integer,
    reaction_count      integer,
    top_reactions       public.post_reaction[],
    my_reaction         public.post_reaction,
    is_author           boolean,
    can_edit            boolean,
    can_delete          boolean,
    attachments         jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_profile_id bigint;
  page_ids uuid[];
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if (p_cursor_published_at is null) <> (p_cursor_post_id is null) then
    raise exception 'post cursor must be complete' using errcode = '22023';
  end if;

  select profile.id into target_profile_id
  from public.profiles as profile
  where profile.pub_id = lower(btrim(p_timeline_pub_id))
    and profile.status = 'accepted'
    and profile.deleted_at is null;
  if target_profile_id is null then
    return;
  end if;

  select array_agg(page.id) into page_ids
  from (
    select post.id
    from public.posts as post
    where post.timeline_profile_id = target_profile_id
      and post.kind = 'profile'
      and post.published_at is not null
      and (
        post.visibility = 'public'
        or exists (
          select 1 from private.post_authors as author
          where author.post_id = post.id and author.profile_id = caller_profile_id
        )
      )
      and (
        p_cursor_post_id is null
        or (post.published_at, post.id) < (p_cursor_published_at, p_cursor_post_id)
      )
    order by post.published_at desc, post.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) as page;

  -- 첨부를 같이 담는다. 목록을 받은 뒤 첨부를 따로 물으면 타임라인을 열 때마다 왕복이 하나 더 붙는다.
  return query
  select entry.*, private.post_attachments_json(entry.post_id)
  from private.read_profile_posts(
    coalesce(page_ids, '{}'::uuid[]), caller_profile_id
  ) as entry
  order by entry.published_at desc, entry.post_id desc;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."post_attachments_json"(uuid) FROM PUBLIC;
