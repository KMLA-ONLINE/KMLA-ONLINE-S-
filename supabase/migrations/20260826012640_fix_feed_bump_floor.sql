-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

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
  candidate record;
  next_position integer := 1;
  page_counts jsonb := '{}'::jsonb;
  last_source_type text;
  last_source_id text;
  consecutive_count integer := 0;
  source_count integer;
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

  create temporary table if not exists feed_ranked_candidates (
    priority bigint primary key,
    post_id uuid not null unique,
    rank_time timestamptz not null,
    source_type text not null,
    source_id text not null
  ) on commit drop;
  truncate table feed_ranked_candidates;

  insert into feed_ranked_candidates (
    priority, post_id, rank_time, source_type, source_id
  )
  select
    row_number() over (
      order by ranked.rank_time desc, ranked.published_at desc, ranked.post_id desc
    ),
    ranked.post_id,
    ranked.rank_time,
    ranked.source_type,
    ranked.source_id
  from (
    select
      post.id as post_id,
      post.published_at,
      private.feed_rank_time(
        post.published_at,
        bump.effective_at,
        epoch,
        coalesce(reaction.total, 0),
        coalesce(comment.total, 0),
        post.kind = 'profile' and author.profile_id <> post.timeline_profile_id,
        post.activity_kind is not null
      ) as rank_time,
      case post.kind when 'group' then 'group' else 'profile' end as source_type,
      case post.kind
        when 'group' then post.group_id::text
        else author.profile_id::text
      end as source_id
    from public.posts as post
    join private.post_authors as author on author.post_id = post.id
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
      and post.deleted_at is null
      and private.can_access_feed_post(post.id, p_profile_id)
  ) as ranked;

  while exists (select 1 from feed_ranked_candidates) loop
    if (next_position - 1) % 20 = 0 then
      page_counts := '{}'::jsonb;
    end if;

    select item.* into candidate
    from feed_ranked_candidates as item
    where coalesce((page_counts ->> (item.source_type || ':' || item.source_id))::integer, 0)
        < case item.source_type when 'profile' then 4 else 10 end
      and not (
        item.source_type = last_source_type
        and item.source_id = last_source_id
        and consecutive_count >= case item.source_type when 'profile' then 2 else 3 end
      )
    order by item.priority
    limit 1;

    if not found then
      select item.* into candidate
      from feed_ranked_candidates as item
      order by item.priority
      limit 1;
    end if;

    insert into private.feed_session_posts (session_id, position, post_id, rank_time)
    values (session_id, next_position, candidate.post_id, candidate.rank_time);
    delete from feed_ranked_candidates where post_id = candidate.post_id;

    source_count := coalesce(
      (page_counts ->> (candidate.source_type || ':' || candidate.source_id))::integer,
      0
    ) + 1;
    page_counts := jsonb_set(
      page_counts,
      array[candidate.source_type || ':' || candidate.source_id],
      to_jsonb(source_count),
      true
    );

    if candidate.source_type = last_source_type
      and candidate.source_id = last_source_id then
      consecutive_count := consecutive_count + 1;
    else
      last_source_type := candidate.source_type;
      last_source_id := candidate.source_id;
      consecutive_count := 1;
    end if;

    next_position := next_position + 1;
  end loop;

  return session_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.feed_rank_time (
  p_published_at              timestamp with time zone,
  p_bumped_at                 timestamp with time zone,
  p_feed_epoch                timestamp with time zone,
  p_reaction_count            integer,
  p_ranking_comment_count     integer,
  p_is_cross_timeline         boolean,
  p_is_profile_media_activity boolean
)
  RETURNS timestamp WITH time zone
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path TO ''
  AS $function$
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
$function$;