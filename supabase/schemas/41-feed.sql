-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


CREATE OR REPLACE FUNCTION "private"."can_access_feed_post"("p_post_id" "uuid", "p_profile_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "private"."can_access_feed_post"("p_post_id" "uuid", "p_profile_id" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."capture_effective_feed_bump"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.depth <> 0
    or new.author_identity not in ('identified', 'staff')
    or btrim(new.body) <> '#업' then
    return new;
  end if;

  if not exists (
    select 1
    from public.posts as post
    where post.id = new.post_id
      and post.kind = 'group'
      and post.published_at is not null
  ) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('feed-bump:' || new.post_id::text, 0)
  );

  if not exists (
    select 1
    from private.feed_bump_events as bump
    where bump.post_id = new.post_id
      and bump.effective_at > new.created_at - interval '1 hour'
  ) then
    insert into private.feed_bump_events (post_id, comment_id, effective_at)
    values (new.post_id, new.id, new.created_at);
  end if;

  return new;
end;
$$;

ALTER FUNCTION "private"."capture_effective_feed_bump"() OWNER TO "postgres";

-- 게시물이 사라지는 중이면 반응 취소 이력을 남기지 않는다. 게시물을 지우면 반응이 CASCADE로
-- 함께 지워지고 이 트리거가 행마다 도는데, 그때 -1 이벤트를 넣으면 이미 없어진 게시물을 가리켜
-- 외래 키 위반이 난다. 남긴다 해도 같은 CASCADE에 곧 지워질 행이다. 정리 경로가 세우는
-- `app.feed_event_purge`로 그 상황을 구분한다(삭제 및 보존 정책 §7.4).
CREATE OR REPLACE FUNCTION "private"."capture_post_reaction_count_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'INSERT' then
    insert into private.post_reaction_count_events (post_id, delta, occurred_at)
    values (new.post_id, 1, new.created_at);
  elsif tg_op = 'DELETE'
    and coalesce(
      pg_catalog.current_setting('app.feed_event_purge', true), ''
    ) <> 'on' then
    insert into private.post_reaction_count_events (post_id, delta)
    values (old.post_id, -1);
  end if;
  return coalesce(new, old);
end;
$$;

ALTER FUNCTION "private"."capture_post_reaction_count_event"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."cleanup_expired_feed_sessions"() RETURNS bigint
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with deleted as (
    delete from private.feed_sessions
    where expires_at <= statement_timestamp()
    returning 1
  )
  select count(*) from deleted;
$$;

ALTER FUNCTION "private"."cleanup_expired_feed_sessions"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."create_feed_session"("p_profile_id" bigint) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "private"."create_feed_session"("p_profile_id" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."feed_profile_cohorts"("p_profile_id" bigint) RETURNS smallint[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select case
    when profile.type = 'student' and profile.cohort is not null then
      case when profile.is_returning_student
        then array[profile.cohort, (profile.cohort + 1)::smallint]
        else array[profile.cohort]
      end
    when profile.type = 'alumni'
      and profile.cohort is not null
      and exists (
        select 1
        from public.profiles as student
        where student.type = 'student'
          and student.status = 'accepted'
          and student.deleted_at is null
          and student.cohort = profile.cohort
      ) then array[profile.cohort]
    else '{}'::smallint[]
  end
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null;
$$;

ALTER FUNCTION "private"."feed_profile_cohorts"("p_profile_id" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."feed_rank_time"("p_published_at" timestamp with time zone, "p_bumped_at" timestamp with time zone, "p_feed_epoch" timestamp with time zone, "p_reaction_count" integer, "p_ranking_comment_count" integer, "p_is_cross_timeline" boolean, "p_is_profile_media_activity" boolean) RETURNS timestamp with time zone
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
  select greatest(
    p_bumped_at,
    (
      case
        when p_published_at <= p_feed_epoch
          and p_published_at > p_feed_epoch - interval '6 hours' then
          p_published_at
          + make_interval(secs => least(
              (greatest(coalesce(p_reaction_count, 0), 0) * 4
                + greatest(coalesce(p_ranking_comment_count, 0), 0) * 8) * 60.0,
              greatest(
                0.0,
                2400.0 * (
                  1.0 - extract(epoch from (p_feed_epoch - p_published_at)) / 21600.0
                )
              )
            ))
          - case when coalesce(p_is_cross_timeline, false)
              then interval '1 hour' else interval '0' end
        else p_published_at
      end
    ) - case
      when coalesce(p_is_profile_media_activity, false)
        and p_published_at <= p_feed_epoch
        and p_published_at > p_feed_epoch - interval '6 hours'
        then interval '10 minutes'
      else interval '0'
    end
  );
$$;

ALTER FUNCTION "private"."feed_rank_time"("p_published_at" timestamp with time zone, "p_bumped_at" timestamp with time zone, "p_feed_epoch" timestamp with time zone, "p_reaction_count" integer, "p_ranking_comment_count" integer, "p_is_cross_timeline" boolean, "p_is_profile_media_activity" boolean) OWNER TO "postgres";

-- 랭킹 이벤트는 순위가 오른 사실의 기록이다. 지우고 다시 만들어 순위를 반복해서 올리는 길을
-- 막아야 하므로 UPDATE는 어떤 경우에도 통과시키지 않는다.
--
-- DELETE에만 예외를 둔다. 게시물이 사라지면 그 이벤트도 함께 사라져야 하는데 외래 키 CASCADE도
-- 이 트리거를 거치기 때문이다. 정리 경로가 `app.feed_event_purge`를 세워 스스로를 밝히며, 그
-- 설정은 트랜잭션 지역이라 밖으로 새지 않는다. 두 테이블은 private 스키마에 있고 authenticated
-- 권한이 없어, 클라이언트가 이 설정을 세워도 행에 도달할 수 없다(삭제 및 보존 정책 §7.4).
CREATE OR REPLACE FUNCTION "private"."reject_feed_event_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if "tg_op" = 'DELETE'
    and "pg_catalog"."current_setting"('app.feed_event_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'feed ranking events are append-only' using errcode = '55000';
end;
$$;

ALTER FUNCTION "private"."reject_feed_event_mutation"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_feed_posts"("p_page_token" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("feed_epoch" timestamp with time zone, "next_page_token" "uuid", "feed_position" integer, "rank_time" timestamp with time zone, "post_id" "uuid", "kind" "public"."post_kind", "body" "text", "title" "text", "author_identity" "public"."post_identity", "author_pub_id" "text", "author_name" "text", "author_avatar_path" "text", "author_label" "text", "group_id" "uuid", "group_slug" "text", "group_name" "text", "category_name" "text", "is_pinned" boolean, "timeline_pub_id" "text", "timeline_name" "text", "activity_kind" "public"."profile_media_activity_kind", "activity_media_path" "text", "visibility" "public"."post_visibility", "published_at" timestamp with time zone, "edited_at" timestamp with time zone, "comment_count" integer, "reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction", "attachments" "jsonb", "is_author" boolean, "mentions" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."list_feed_posts"("p_page_token" "uuid") OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "private"."feed_bump_events" (
    "id" bigint NOT NULL,
    "post_id" "uuid" NOT NULL,
    "comment_id" "uuid" NOT NULL,
    "effective_at" timestamp with time zone NOT NULL
);

ALTER TABLE "private"."feed_bump_events" OWNER TO "postgres";

ALTER TABLE "private"."feed_bump_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "private"."feed_bump_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS "private"."feed_pages" (
    "token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "after_position" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "feed_pages_position_check" CHECK (("after_position" >= 0))
);

ALTER TABLE "private"."feed_pages" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "private"."feed_session_posts" (
    "session_id" "uuid" NOT NULL,
    "position" integer NOT NULL,
    "post_id" "uuid" NOT NULL,
    "rank_time" timestamp with time zone NOT NULL,
    CONSTRAINT "feed_session_posts_position_check" CHECK (("position" > 0))
);

ALTER TABLE "private"."feed_session_posts" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "private"."feed_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" bigint NOT NULL,
    "feed_epoch" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "feed_sessions_expiry_check" CHECK (("expires_at" > "feed_epoch"))
);

ALTER TABLE "private"."feed_sessions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "private"."post_reaction_count_events" (
    "id" bigint NOT NULL,
    "post_id" "uuid" NOT NULL,
    "delta" smallint NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "post_reaction_count_events_delta_check" CHECK (("delta" = ANY (ARRAY['-1'::integer, 1])))
);

ALTER TABLE "private"."post_reaction_count_events" OWNER TO "postgres";

ALTER TABLE "private"."post_reaction_count_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "private"."post_reaction_count_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY "private"."feed_bump_events"
    ADD CONSTRAINT "feed_bump_events_comment_id_key" UNIQUE ("comment_id");

ALTER TABLE ONLY "private"."feed_bump_events"
    ADD CONSTRAINT "feed_bump_events_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "private"."feed_pages"
    ADD CONSTRAINT "feed_pages_pkey" PRIMARY KEY ("token");

ALTER TABLE ONLY "private"."feed_pages"
    ADD CONSTRAINT "feed_pages_session_id_after_position_key" UNIQUE ("session_id", "after_position");

ALTER TABLE ONLY "private"."feed_session_posts"
    ADD CONSTRAINT "feed_session_posts_pkey" PRIMARY KEY ("session_id", "position");

ALTER TABLE ONLY "private"."feed_session_posts"
    ADD CONSTRAINT "feed_session_posts_session_id_post_id_key" UNIQUE ("session_id", "post_id");

ALTER TABLE ONLY "private"."feed_sessions"
    ADD CONSTRAINT "feed_sessions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "private"."post_reaction_count_events"
    ADD CONSTRAINT "post_reaction_count_events_pkey" PRIMARY KEY ("id");

CREATE INDEX "feed_bump_events_rank_idx" ON "private"."feed_bump_events" USING "btree" ("post_id", "effective_at" DESC, "id" DESC);

CREATE INDEX "feed_session_posts_post_idx" ON "private"."feed_session_posts" USING "btree" ("post_id");

CREATE INDEX "feed_sessions_profile_expiry_idx" ON "private"."feed_sessions" USING "btree" ("profile_id", "expires_at");

CREATE INDEX "feed_sessions_expiry_idx" ON "private"."feed_sessions" USING "btree" ("expires_at");

CREATE INDEX "feed_sessions_profile_created_idx" ON "private"."feed_sessions" USING "btree" ("profile_id", "created_at" DESC, "id" DESC);

CREATE INDEX "post_reaction_count_events_rank_idx" ON "private"."post_reaction_count_events" USING "btree" ("post_id", "occurred_at", "id");

CREATE OR REPLACE TRIGGER "feed_bump_events_append_only" BEFORE DELETE OR UPDATE ON "private"."feed_bump_events" FOR EACH ROW EXECUTE FUNCTION "private"."reject_feed_event_mutation"();

CREATE OR REPLACE TRIGGER "post_reaction_count_events_append_only" BEFORE DELETE OR UPDATE ON "private"."post_reaction_count_events" FOR EACH ROW EXECUTE FUNCTION "private"."reject_feed_event_mutation"();

CREATE OR REPLACE TRIGGER "post_comments_capture_effective_feed_bump" AFTER INSERT ON "public"."post_comments" FOR EACH ROW EXECUTE FUNCTION "private"."capture_effective_feed_bump"();

CREATE OR REPLACE TRIGGER "post_reactions_capture_count_event" AFTER INSERT OR DELETE ON "public"."post_reactions" FOR EACH ROW EXECUTE FUNCTION "private"."capture_post_reaction_count_event"();

ALTER TABLE ONLY "private"."feed_bump_events"
    ADD CONSTRAINT "feed_bump_events_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."post_comments"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."feed_bump_events"
    ADD CONSTRAINT "feed_bump_events_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."feed_pages"
    ADD CONSTRAINT "feed_pages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "private"."feed_sessions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."feed_session_posts"
    ADD CONSTRAINT "feed_session_posts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."feed_session_posts"
    ADD CONSTRAINT "feed_session_posts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "private"."feed_sessions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."feed_sessions"
    ADD CONSTRAINT "feed_sessions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."post_reaction_count_events"
    ADD CONSTRAINT "post_reaction_count_events_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;

ALTER TABLE "private"."feed_bump_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feed_bump_events_deny_client_access" ON "private"."feed_bump_events" USING (false) WITH CHECK (false);

ALTER TABLE "private"."feed_pages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feed_pages_deny_client_access" ON "private"."feed_pages" USING (false) WITH CHECK (false);

ALTER TABLE "private"."feed_session_posts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feed_session_posts_deny_client_access" ON "private"."feed_session_posts" USING (false) WITH CHECK (false);

ALTER TABLE "private"."feed_sessions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feed_sessions_deny_client_access" ON "private"."feed_sessions" USING (false) WITH CHECK (false);

ALTER TABLE "private"."post_reaction_count_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_reaction_count_events_deny_client_access" ON "private"."post_reaction_count_events" USING (false) WITH CHECK (false);

REVOKE ALL ON FUNCTION "private"."can_access_feed_post"("p_post_id" "uuid", "p_profile_id" bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."capture_effective_feed_bump"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."capture_post_reaction_count_event"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."cleanup_expired_feed_sessions"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."create_feed_session"("p_profile_id" bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."feed_profile_cohorts"("p_profile_id" bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."feed_rank_time"("p_published_at" timestamp with time zone, "p_bumped_at" timestamp with time zone, "p_feed_epoch" timestamp with time zone, "p_reaction_count" integer, "p_ranking_comment_count" integer, "p_is_cross_timeline" boolean, "p_is_profile_media_activity" boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."reject_feed_event_mutation"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."list_feed_posts"("p_page_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_feed_posts"("p_page_token" "uuid") TO "authenticated";
