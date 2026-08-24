create table private.post_reaction_count_events (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts (id),
  delta smallint not null constraint post_reaction_count_events_delta_check
    check (delta in (-1, 1)),
  occurred_at timestamptz not null default clock_timestamp()
);

create index post_reaction_count_events_rank_idx
on private.post_reaction_count_events (post_id, occurred_at, id);

create table private.feed_bump_events (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts (id),
  comment_id uuid not null unique references public.post_comments (id),
  effective_at timestamptz not null
);

create index feed_bump_events_rank_idx
on private.feed_bump_events (post_id, effective_at desc, id desc);

create table private.feed_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id bigint not null references public.profiles (id) on delete cascade,
  feed_epoch timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  constraint feed_sessions_expiry_check check (expires_at > feed_epoch)
);

create index feed_sessions_profile_expiry_idx
on private.feed_sessions (profile_id, expires_at);

create table private.feed_session_posts (
  session_id uuid not null references private.feed_sessions (id) on delete cascade,
  position integer not null constraint feed_session_posts_position_check check (position > 0),
  post_id uuid not null references public.posts (id) on delete cascade,
  rank_time timestamptz not null,
  primary key (session_id, position),
  unique (session_id, post_id)
);

create index feed_session_posts_post_idx
on private.feed_session_posts (post_id);

create index profiles_active_student_cohort_idx
on public.profiles (cohort)
where type = 'student' and status = 'accepted' and deleted_at is null;

create table private.feed_pages (
  token uuid primary key default gen_random_uuid(),
  session_id uuid not null references private.feed_sessions (id) on delete cascade,
  after_position integer not null constraint feed_pages_position_check check (after_position >= 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (session_id, after_position)
);

alter table private.post_reaction_count_events enable row level security;
alter table private.feed_bump_events enable row level security;
alter table private.feed_sessions enable row level security;
alter table private.feed_session_posts enable row level security;
alter table private.feed_pages enable row level security;

create policy "post_reaction_count_events_deny_client_access"
on private.post_reaction_count_events for all to public using (false) with check (false);
create policy "feed_bump_events_deny_client_access"
on private.feed_bump_events for all to public using (false) with check (false);
create policy "feed_sessions_deny_client_access"
on private.feed_sessions for all to public using (false) with check (false);
create policy "feed_session_posts_deny_client_access"
on private.feed_session_posts for all to public using (false) with check (false);
create policy "feed_pages_deny_client_access"
on private.feed_pages for all to public using (false) with check (false);

revoke all on table private.post_reaction_count_events from public, anon, authenticated;
revoke all on table private.feed_bump_events from public, anon, authenticated;
revoke all on table private.feed_sessions from public, anon, authenticated;
revoke all on table private.feed_session_posts from public, anon, authenticated;
revoke all on table private.feed_pages from public, anon, authenticated;

create function private.reject_feed_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'feed ranking events are append-only' using errcode = '55000';
end;
$$;

revoke all on function private.reject_feed_event_mutation() from public, anon, authenticated;

create trigger post_reaction_count_events_append_only
before update or delete on private.post_reaction_count_events
for each row execute function private.reject_feed_event_mutation();

create trigger feed_bump_events_append_only
before update or delete on private.feed_bump_events
for each row execute function private.reject_feed_event_mutation();

create function private.cleanup_expired_feed_sessions()
returns bigint
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from private.feed_sessions
    where expires_at <= statement_timestamp()
    returning 1
  )
  select count(*) from deleted;
$$;

revoke all on function private.cleanup_expired_feed_sessions()
from public, anon, authenticated;

select cron.schedule(
  'cleanup-expired-feed-sessions-hourly',
  '23 * * * *',
  'select private.cleanup_expired_feed_sessions()'
);

create function private.capture_post_reaction_count_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into private.post_reaction_count_events (post_id, delta, occurred_at)
    values (new.post_id, 1, new.created_at);
  elsif tg_op = 'DELETE' then
    insert into private.post_reaction_count_events (post_id, delta)
    values (old.post_id, -1);
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.capture_post_reaction_count_event()
from public, anon, authenticated;

insert into private.post_reaction_count_events (post_id, delta, occurred_at)
select reaction.post_id, 1, reaction.created_at
from public.post_reactions as reaction;

create trigger post_reactions_capture_count_event
after insert or delete on public.post_reactions
for each row execute function private.capture_post_reaction_count_event();

create function private.capture_effective_feed_bump()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
      and post.deleted_at is null
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

revoke all on function private.capture_effective_feed_bump()
from public, anon, authenticated;

create trigger post_comments_capture_effective_feed_bump
after insert on public.post_comments
for each row execute function private.capture_effective_feed_bump();

create function private.feed_rank_time(
  p_published_at timestamptz,
  p_bumped_at timestamptz,
  p_feed_epoch timestamptz,
  p_reaction_count integer,
  p_ranking_comment_count integer,
  p_is_cross_timeline boolean
)
returns timestamptz
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_bumped_at is not null then p_bumped_at
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
  end;
$$;

revoke all on function private.feed_rank_time(
  timestamptz, timestamptz, timestamptz, integer, integer, boolean
) from public, anon, authenticated;

create function private.feed_profile_cohorts(p_profile_id bigint)
returns smallint[]
language sql
stable
security definer
set search_path = ''
as $$
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

revoke all on function private.feed_profile_cohorts(bigint)
from public, anon, authenticated;

create function private.can_access_feed_post(p_post_id uuid, p_profile_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.posts as post
    join private.post_authors as author on author.post_id = post.id
    left join public.profiles as timeline
      on timeline.id = post.timeline_profile_id
      and timeline.status = 'accepted'
      and timeline.deleted_at is null
    where post.id = p_post_id
      and post.published_at is not null
      and post.deleted_at is null
      and (
        (
          post.kind = 'group'
          and exists (
            select 1
            from public.group_memberships as membership
            join public.groups as group_record on group_record.id = membership.group_id
            where membership.group_id = post.group_id
              and membership.profile_id = p_profile_id
              and group_record.deleted_at is null
          )
        )
        or (
          post.kind = 'profile'
          and post.visibility = 'public'
          and timeline.id is not null
          and (
            author.profile_id = post.timeline_profile_id
            or private.feed_profile_cohorts(p_profile_id)
              && private.feed_profile_cohorts(post.timeline_profile_id)
          )
        )
      )
  );
$$;

revoke all on function private.can_access_feed_post(uuid, bigint)
from public, anon, authenticated;

create function private.create_feed_session(p_profile_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_id uuid := gen_random_uuid();
  epoch timestamptz := statement_timestamp();
  candidate record;
  next_position integer := 1;
  page_counts jsonb := '{}'::jsonb;
  last_source_type text;
  last_source_id text;
  consecutive_count integer := 0;
  source_count integer;
begin
  delete from private.feed_sessions
  where profile_id = p_profile_id and expires_at <= epoch;

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
        post.kind = 'profile' and author.profile_id <> post.timeline_profile_id
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
    ) as reaction on bump.effective_at is null
      and post.published_at > epoch - interval '6 hours'
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
    ) as comment on bump.effective_at is null
      and post.published_at > epoch - interval '6 hours'
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
$$;

revoke all on function private.create_feed_session(bigint)
from public, anon, authenticated;

create function public.list_feed_posts(p_page_token uuid default null)
returns table (
  feed_epoch timestamptz,
  next_page_token uuid,
  feed_position integer,
  rank_time timestamptz,
  post_id uuid,
  kind public.post_kind,
  body text,
  title text,
  author_identity public.post_identity,
  author_pub_id text,
  author_name text,
  author_avatar_path text,
  author_label text,
  group_id uuid,
  group_slug text,
  group_name text,
  category_name text,
  timeline_pub_id text,
  timeline_name text,
  activity_kind public.profile_media_activity_kind,
  activity_media_path text,
  visibility public.post_visibility,
  published_at timestamptz,
  edited_at timestamptz,
  comment_count integer,
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction,
  attachments jsonb,
  is_author boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
    author.profile_id = caller_profile_id
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
          'height', attachment.height,
          'status', attachment.status,
          'created_at', attachment.created_at,
          'ready_at', attachment.ready_at
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

revoke all on function public.list_feed_posts(uuid) from public, anon;
grant execute on function public.list_feed_posts(uuid) to authenticated;
