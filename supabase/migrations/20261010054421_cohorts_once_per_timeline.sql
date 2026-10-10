SET local check_function_bodies = off;

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
  --
  -- 생탐 판정에 쓰는 타임라인 주인의 관련 기수도 게시물마다 구하지 않고 주인마다 한 번만 구한다.
  -- 보는 사람에게 관련 기수가 없으면 생탐은 어차피 들어오지 않으므로 아무도 구하지 않는다.
  with timeline_cohorts as materialized (
    select timeline.profile_id, private.feed_profile_cohorts(timeline.profile_id) as cohorts
    from (
      select distinct post.timeline_profile_id as profile_id
      from public.posts as post
      where post.kind = 'profile'
        and post.timeline_profile_id is not null
        and post.published_at is not null
        and coalesce(cardinality(viewer_cohorts), 0) > 0
    ) as timeline
  ),
  candidates as (
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
    left join timeline_cohorts
      on timeline_cohorts.profile_id = post.timeline_profile_id
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
              (viewer_cohorts && timeline_cohorts.cohorts)
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
