SET local check_function_bodies = off;

DROP FUNCTION "public"."list_group_posts"(uuid, uuid, timestamp WITH time zone, uuid, boolean, integer);

DROP FUNCTION "public"."list_profile_posts"(text, timestamp WITH time zone, uuid, integer);

CREATE OR REPLACE FUNCTION private.create_feed_session (
  p_profile_id bigint
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  session_id uuid;
  epoch timestamptz := statement_timestamp();
  viewer_cohorts smallint[] := private.feed_profile_cohorts(p_profile_id);
  -- 후보는 순위 순서의 배열이다. 배열 번호가 곧 순위(priority)이고, 출처는 1부터 매긴 번호로 둔다.
  candidate_post_ids uuid[];
  candidate_rank_times timestamptz[];
  candidate_sources integer[];
  candidate_total integer;
  -- 출처별 후보: `source_items`에 출처 번호 순, 같은 출처 안에서는 순위 순으로 이어 붙인 순위 목록.
  -- `source_next`는 그 출처에서 아직 배치하지 않은 첫 칸, `source_last`는 마지막 칸이다.
  -- 출처별 페이지 제한과 연속 제한. 개인은 4개·2개, 그룹은 10개·3개다.
  source_page_limits integer[];
  source_run_limits integer[];
  source_items integer[];
  source_next integer[];
  source_last integer[];
  source_total integer;
  -- frontier는 아직 한 번도 살펴보지 않은 첫 순위다. 그보다 앞인데 남아 있는 후보는 제한에 걸려
  -- 밀린 것이고, 그런 후보가 있는 출처를 `deferred`에 둔다.
  frontier integer := 1;
  deferred integer[] := '{}'::integer[];
  page_counts integer[];
  placed integer[];
  placed_count integer := 0;
  last_source integer;
  consecutive_count integer := 0;
  chosen integer;
  chosen_source integer;
  item_source integer;
  head integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('feed-session:' || p_profile_id::text, 0)
  );

  delete from private.feed_sessions
  where profile_id = p_profile_id and expires_at <= epoch;

  select session.id into session_id
  from private.feed_sessions as session
  where session.profile_id = p_profile_id
    and session.expires_at > epoch
    and session.created_at >= epoch - interval '5 seconds'
  order by session.created_at desc, session.id desc
  limit 1;

  if session_id is not null then
    return session_id;
  end if;

  with excess as (
    select session.id
    from private.feed_sessions as session
    where session.profile_id = p_profile_id
      and session.expires_at > epoch
    order by session.created_at desc, session.id desc
    offset 7
  )
  delete from private.feed_sessions as session
  using excess
  where session.id = excess.id;

  session_id := gen_random_uuid();

  insert into private.feed_sessions (id, profile_id, feed_epoch, expires_at)
  values (session_id, p_profile_id, epoch, epoch + interval '24 hours');

  -- 접근 조건은 `can_access_feed_post()`를 집합 조건으로 옮긴 것이다. 후보마다 그 함수를 부르면
  -- security definer 호출 비용이 후보 수만큼 쌓인다. 두 조건이 같은 게시물을 고르는지는
  -- `integrated_feed.test.sql`이 확인한다.
  with candidates as (
    select
      post.id as post_id,
      post.published_at,
      -- 6시간이 지났고 `#업`도 없는 게시물은 `feed_rank_time()`이 게시 시각을 그대로 돌려준다.
      -- 후보 대부분이 그런 지난 글이라 호출을 건너뛴다(search_path를 고정한 함수라 인라인되지 않는다).
      case
        when post.published_at <= epoch - interval '6 hours' and bump.effective_at is null
          then post.published_at
        else private.feed_rank_time(
          post.published_at,
          bump.effective_at,
          epoch,
          coalesce(reaction.total, 0),
          coalesce(comment.total, 0),
          post.kind = 'profile' and author.profile_id <> post.timeline_profile_id,
          post.activity_kind is not null
        )
      end as rank_time,
      post.kind <> 'group' as is_profile,
      case post.kind
        when 'group' then post.group_id::text
        else author.profile_id::text
      end as source_id
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
    left join lateral (
      select event.effective_at
      from private.feed_bump_events as event
      where event.post_id = post.id and event.effective_at <= epoch
      order by event.effective_at desc, event.id desc
      limit 1
    ) as bump on true
    left join lateral (
      select coalesce(sum(event.delta), 0)::integer as total
      from private.post_reaction_count_events as event
      where event.post_id = post.id and event.occurred_at <= epoch
    ) as reaction on post.published_at > epoch - interval '6 hours'
    left join lateral (
      select count(*)::integer as total
      from public.post_comments as entry
      join private.comment_authors as comment_author on comment_author.comment_id = entry.id
      where entry.post_id = post.id
        and entry.depth = 0
        and entry.deleted_at is null
        and entry.created_at <= epoch
        and btrim(entry.body) <> '#업'
        and comment_author.profile_id <> author.profile_id
    ) as comment on post.published_at > epoch - interval '6 hours'
    where post.published_at is not null
      and post.published_at <= epoch
      and (
        (
          post.kind = 'group'
          and post.group_id in (
            select membership.group_id
            from public.group_memberships as membership
            join public.groups as group_record on group_record.id = membership.group_id
            where membership.profile_id = p_profile_id
          )
        )
        or (
          post.kind = 'profile'
          and post.visibility = 'public'
          and timeline.id is not null
          and (
            author.profile_id = post.timeline_profile_id
            or (
              (viewer_cohorts && private.feed_profile_cohorts(post.timeline_profile_id))
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
  ),
  numbered as (
    select
      candidate.*,
      row_number() over (
        order by candidate.rank_time desc, candidate.published_at desc, candidate.post_id desc
      )::integer as priority,
      dense_rank() over (
        order by candidate.is_profile, candidate.source_id
      )::integer as source_number
    from candidates as candidate
  ),
  slotted as (
    select
      numbered.*,
      row_number() over (
        order by numbered.source_number, numbered.priority
      )::integer as slot
    from numbered
  ),
  sources as (
    select
      slotted.source_number,
      bool_or(slotted.is_profile) as is_profile,
      min(slotted.slot)::integer as first_slot,
      max(slotted.slot)::integer as last_slot
    from slotted
    group by slotted.source_number
  )
  select
    (select array_agg(slotted.post_id order by slotted.priority) from slotted),
    (select array_agg(slotted.rank_time order by slotted.priority) from slotted),
    (select array_agg(slotted.source_number order by slotted.priority) from slotted),
    (select array_agg(slotted.priority order by slotted.slot) from slotted),
    (select array_agg(case when sources.is_profile then 4 else 10 end order by sources.source_number) from sources),
    (select array_agg(case when sources.is_profile then 2 else 3 end order by sources.source_number) from sources),
    (select array_agg(sources.first_slot order by sources.source_number) from sources),
    (select array_agg(sources.last_slot order by sources.source_number) from sources)
  into
    candidate_post_ids,
    candidate_rank_times,
    candidate_sources,
    source_items,
    source_page_limits,
    source_run_limits,
    source_next,
    source_last;

  candidate_total := coalesce(cardinality(candidate_post_ids), 0);
  if candidate_total = 0 then
    return session_id;
  end if;

  source_total := cardinality(source_next);
  placed := pg_catalog.array_fill(0, array[candidate_total]);

  -- 출처 제한(FEED_ALGORITHM.md §5): 자리마다 남은 후보 중 두 제한을 모두 만족하는 가장 높은
  -- 순위를 고르고, 없으면 남은 것 중 가장 높은 순위를 고른다. 남은 후보를 매번 처음부터 훑지
  -- 않는다. 같은 출처의 후보는 제한 결과가 같으므로 밀린 출처마다 맨 앞 하나만 보면 되고,
  -- 그런 출처는 몇 개뿐이다. 거기서 고를 수 없을 때만 frontier를 민다. 고르는 순서는 같고 일은
  -- 후보 수에 비례한다.
  while placed_count < candidate_total loop
    if placed_count % 20 = 0 then
      page_counts := pg_catalog.array_fill(0, array[source_total]);
    end if;

    chosen := null;

    foreach item_source in array deferred loop
      if page_counts[item_source] < source_page_limits[item_source]
        and not (
          item_source = last_source
          and consecutive_count >= source_run_limits[item_source]
        ) then
        head := source_items[source_next[item_source]];
        if chosen is null or head < chosen then
          chosen := head;
          chosen_source := item_source;
        end if;
      end if;
    end loop;

    -- 밀린 출처가 하나도 통과하지 못했다. frontier의 후보는 그들보다 순위가 낮으므로 이제 본다.
    -- 밀린 출처의 후보는 그 출처가 지금 제한에 걸려 있다는 뜻이라 그대로 지나친다.
    while chosen is null and frontier <= candidate_total loop
      item_source := candidate_sources[frontier];
      if item_source <> all(deferred) then
        if page_counts[item_source] < source_page_limits[item_source]
          and not (
            item_source = last_source
            and consecutive_count >= source_run_limits[item_source]
          ) then
          chosen := frontier;
          chosen_source := item_source;
        else
          deferred := deferred || item_source;
        end if;
      end if;
      frontier := frontier + 1;
    end loop;

    if chosen is null then
      -- 제한을 만족하는 후보가 없다. 남은 것 중 가장 높은 순위로 채운다.
      foreach item_source in array deferred loop
        head := source_items[source_next[item_source]];
        if chosen is null or head < chosen then
          chosen := head;
          chosen_source := item_source;
        end if;
      end loop;
    end if;

    placed_count := placed_count + 1;
    placed[placed_count] := chosen;
    source_next[chosen_source] := source_next[chosen_source] + 1;
    if chosen_source = any(deferred)
      and (
        source_next[chosen_source] > source_last[chosen_source]
        or source_items[source_next[chosen_source]] >= frontier
      ) then
      deferred := pg_catalog.array_remove(deferred, chosen_source);
    end if;

    page_counts[chosen_source] := page_counts[chosen_source] + 1;
    if chosen_source = last_source then
      consecutive_count := consecutive_count + 1;
    else
      last_source := chosen_source;
      consecutive_count := 1;
    end if;
  end loop;

  insert into private.feed_session_posts (session_id, position, post_id, rank_time)
  select
    session_id,
    slot.position::integer,
    candidate_post_ids[slot.priority],
    candidate_rank_times[slot.priority]
  from unnest(placed) with ordinality as slot(priority, position);

  return session_id;
end;
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
          'thumbnail_path', attachment.thumbnail_path,
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
    attachment_summary.items
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
  -- 첨부를 같이 담는다. 목록을 받은 뒤 첨부를 따로 물으면 그룹 화면마다 왕복이 하나 더 붙는다.
  left join lateral (
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
        ) order by attachment.position, attachment.id
      ),
      '[]'::jsonb
    ) as items
    from public.post_attachments as attachment
    where attachment.post_id = post.id and attachment.status = 'ready'
  ) as attachment_summary on true
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

REVOKE ALL ON FUNCTION "public"."list_group_posts"(uuid, uuid, timestamp WITH time zone, uuid, boolean, integer) FROM PUBLIC, "anon", "service_role";

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
  select entry.*, attachment_summary.items
  from private.read_profile_posts(
    coalesce(page_ids, '{}'::uuid[]), caller_profile_id
  ) as entry
  left join lateral (
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
        ) order by attachment.position, attachment.id
      ),
      '[]'::jsonb
    ) as items
    from public.post_attachments as attachment
    where attachment.post_id = entry.post_id and attachment.status = 'ready'
  ) as attachment_summary on true
  order by entry.published_at desc, entry.post_id desc;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_profile_posts"(text, timestamp WITH time zone, uuid, integer) FROM PUBLIC, "anon", "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_group_posts"(uuid, uuid, timestamp WITH time zone, uuid, boolean, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_group_posts"(uuid, uuid, timestamp WITH time zone, uuid, boolean, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_group_posts"(uuid, uuid, timestamp WITH time zone, uuid, boolean, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_profile_posts"(text, timestamp WITH time zone, uuid, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_profile_posts"(text, timestamp WITH time zone, uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_profile_posts"(text, timestamp WITH time zone, uuid, integer) TO "postgres";
