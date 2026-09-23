-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE char_length(description) > 500
  ) THEN
    RAISE EXCEPTION 'profiles.description contains values longer than 500 characters';
  END IF;
END;
$$;

ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_description_length;

ALTER TABLE public.posts
  DROP CONSTRAINT posts_profile_activity_shape;

ALTER TABLE public.user_timetables
  DROP CONSTRAINT user_timetables_json_check;

DROP POLICY gongang_schedule_delete_manager ON public.gongang_schedule;

DROP POLICY gongang_schedule_insert_manager ON public.gongang_schedule;

DROP POLICY gongang_schedule_select ON public.gongang_schedule;

DROP POLICY gongang_schedule_update_manager ON public.gongang_schedule;

DROP POLICY groups_select_visible ON public.groups;

DROP POLICY permissions_select ON public.permissions;

DROP POLICY profile_permissions_select_own ON public.profile_permissions;

DROP POLICY user_timetables_insert_own ON public.user_timetables;

DROP POLICY user_timetables_select_own ON public.user_timetables;

DROP POLICY user_timetables_update_own ON public.user_timetables;

DROP POLICY utility_reservations_delete_own ON public.utility_reservations;

DROP POLICY utility_reservations_insert ON public.utility_reservations;

DROP POLICY utility_reservations_select ON public.utility_reservations;

CREATE OR REPLACE FUNCTION private.can_delete_own_profile_media_path (
  p_object_path text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select private.is_own_profile_media_path(p_object_path)
    and not exists (
      select 1
      from public.profiles as profile
      where p_object_path in (profile.avatar_path, profile.cover_path)
    )
    and not exists (
      select 1
      from public.posts as post
      where post.activity_media_path = p_object_path
        and post.deleted_at is null
    );
$function$;

CREATE FUNCTION private.validate_profile_activity_path()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  owner_auth_user_id uuid;
  media_slot text;
begin
  if new.activity_kind is null then
    return new;
  end if;

  select profile.auth_user_id
  into owner_auth_user_id
  from public.profiles as profile
  where profile.id = new.timeline_profile_id;

  media_slot := case new.activity_kind
    when 'avatar_changed' then 'avatar'
    when 'cover_changed' then 'cover'
  end;

  if owner_auth_user_id is null
    or new.activity_media_path !~ (
      '^' || owner_auth_user_id::text || '/' || media_slot
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  then
    raise exception 'profile activity media path must belong to the timeline owner'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION private.validate_profile_activity_path() FROM PUBLIC;

REVOKE ALL ON FUNCTION private.cleanup_group_post_reports() FROM PUBLIC;

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
$function$;

CREATE OR REPLACE FUNCTION private.is_own_profile_media_path (
  p_object_path text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select p_object_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(avatar|cover)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(p_object_path, '/', 1) = auth.uid()::text
  and exists (
    select 1
    from public.profiles as profile
    where profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
  );
$function$;

CREATE FUNCTION private.is_valid_timetable_semesters (
  timetable jsonb
)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  STRICT
  SET search_path TO ''
  AS $function$
declare
  semester_key text;
  course jsonb;
  meeting jsonb;
  meeting_day numeric;
  meeting_start numeric;
  meeting_end numeric;
begin
  if pg_catalog.jsonb_typeof(timetable) <> 'object' then
    return false;
  end if;

  foreach semester_key in array array[
    '1-1', '1-2', '2-1', '2-2', '3-1', '3-2'
  ]
  loop
    if pg_catalog.jsonb_typeof(timetable -> semester_key)
      is distinct from 'array'
    then
      return false;
    end if;

    for course in
      select element
      from pg_catalog.jsonb_array_elements(
        timetable -> semester_key
      ) as courses(element)
    loop
      if pg_catalog.jsonb_typeof(course) is distinct from 'object'
        or pg_catalog.jsonb_typeof(course -> 'id') is distinct from 'string'
        or pg_catalog.jsonb_typeof(course -> 'name') is distinct from 'string'
        or pg_catalog.jsonb_typeof(course -> 'color') is distinct from 'number'
        or pg_catalog.jsonb_typeof(course -> 'room') is distinct from 'string'
        or pg_catalog.jsonb_typeof(course -> 'meetings') is distinct from 'array'
      then
        return false;
      end if;

      for meeting in
        select element
        from pg_catalog.jsonb_array_elements(
          course -> 'meetings'
        ) as meetings(element)
      loop
        if pg_catalog.jsonb_typeof(meeting) is distinct from 'object'
          or pg_catalog.jsonb_typeof(meeting -> 'id') is distinct from 'string'
          or pg_catalog.jsonb_typeof(meeting -> 'day') is distinct from 'number'
          or pg_catalog.jsonb_typeof(meeting -> 'start') is distinct from 'number'
          or pg_catalog.jsonb_typeof(meeting -> 'end') is distinct from 'number'
        then
          return false;
        end if;

        meeting_day := (meeting ->> 'day')::numeric;
        meeting_start := (meeting ->> 'start')::numeric;
        meeting_end := (meeting ->> 'end')::numeric;

        if meeting_day <> pg_catalog.trunc(meeting_day)
          or meeting_day < 0
          or meeting_day > 4
          or meeting_start <> pg_catalog.trunc(meeting_start)
          or meeting_start < 1
          or meeting_start > 8
          or meeting_end <> pg_catalog.trunc(meeting_end)
          or meeting_end < meeting_start
          or meeting_end > 8
          or (meeting_start <= 4 and meeting_end >= 5)
        then
          return false;
        end if;
      end loop;
    end loop;
  end loop;

  return true;
end;
$function$;

REVOKE ALL ON FUNCTION private.is_valid_timetable_semesters(jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION private.is_valid_timetable_semesters(jsonb) TO authenticated;

GRANT ALL ON FUNCTION private.is_valid_timetable_semesters(jsonb) TO service_role;

CREATE FUNCTION private.lock_reaction_context (
  p_post_id           uuid,
  p_caller_profile_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform 1
  from public.posts as post
  where post.id = p_post_id
    and post.published_at is not null
    and post.deleted_at is null
  for update;

  if not found then
    raise exception 'post not found' using errcode = 'P0002';
  end if;

  perform private.reaction_context(p_post_id, p_caller_profile_id);
end;
$function$;

REVOKE ALL ON FUNCTION private.lock_reaction_context(uuid, bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.prepare_utility_reservation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  caller_profile_name text;
  caller_avatar_path text;
  korea_today date;
  current_monday date;
  first_manager_date date;
  lock_key bigint;
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  select profile.id, profile.name, profile.avatar_path
  into caller_profile_id, caller_profile_name, caller_avatar_path
  from public.profiles as profile
  where profile.id = private.current_profile_id();

  if not found then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  new.profile_id := caller_profile_id;
  new.applicant_name := caller_profile_name;
  new.avatar_path := caller_avatar_path;
  new.detail := btrim(new.detail);
  new.recurring_until := null;

  if new.mode = 'karaoke' then
    new.location := null;
    new.recurring := false;
  end if;

  korea_today := (now() at time zone 'Asia/Seoul')::date;
  current_monday :=
    korea_today - (extract(isodow from korea_today)::integer - 1);

  if new.reservation_date < korea_today
    or new.reservation_date < current_monday
    or new.reservation_date > current_monday + 6
  then
    raise exception 'utility reservations are limited to the current Korea week'
      using errcode = '22023';
  end if;

  lock_key :=
    pg_catalog.hashtextextended(
      pg_catalog.concat_ws(
        '|',
        new.mode,
        new.slot,
        coalesce(new.location, ''),
        extract(dow from new.reservation_date)::integer::text
      ),
      0
    );

  perform pg_catalog.pg_advisory_xact_lock(lock_key);

  if new.mode = 'gongang' and new.recurring then
    select min(schedule.schedule_date)
    into first_manager_date
    from public.gongang_schedule as schedule
    where schedule.reserved = true
      and schedule.slot = new.slot
      and schedule.location = new.location
      and schedule.schedule_date >= new.reservation_date
      and extract(dow from schedule.schedule_date)
        = extract(dow from new.reservation_date);

    new.recurring_until := first_manager_date;
  elsif new.mode = 'gongang' and exists (
    select 1
    from public.gongang_schedule as schedule
    where schedule.reserved = true
      and schedule.schedule_date = new.reservation_date
      and schedule.slot = new.slot
      and schedule.location = new.location
  ) then
    raise exception 'reserved by gongang manager'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.utility_reservations as reservation
    where reservation.mode = new.mode
      and reservation.slot = new.slot
      and reservation.location is not distinct from new.location
      and (
        (
          reservation.recurring = false
          and new.recurring = false
          and reservation.reservation_date = new.reservation_date
        )
        or
        (
          reservation.recurring = true
          and new.recurring = false
          and new.reservation_date >= reservation.reservation_date
          and (
            reservation.recurring_until is null
            or new.reservation_date < reservation.recurring_until
          )
          and extract(dow from new.reservation_date)
            = extract(dow from reservation.reservation_date)
        )
        or
        (
          reservation.recurring = false
          and new.recurring = true
          and reservation.reservation_date >= new.reservation_date
          and (
            new.recurring_until is null
            or reservation.reservation_date < new.recurring_until
          )
          and extract(dow from reservation.reservation_date)
            = extract(dow from new.reservation_date)
        )
        or
        (
          reservation.recurring = true
          and new.recurring = true
          and extract(dow from reservation.reservation_date)
            = extract(dow from new.reservation_date)
          and coalesce(reservation.recurring_until, 'infinity'::date)
            > new.reservation_date
          and coalesce(new.recurring_until, 'infinity'::date)
            > reservation.reservation_date
        )
      )
  ) then
    raise exception 'reservation slot is already occupied'
      using errcode = '23505';
  end if;

  return new;
end;
$function$;

CREATE INDEX feed_sessions_expiry_idx ON private.feed_sessions (expires_at);

CREATE INDEX feed_sessions_profile_created_idx ON private.feed_sessions (profile_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.cancel_utility_reservation (
  p_reservation_id bigint,
  p_effective_date date   DEFAULT NULL::date
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  korea_today date;
  reservation public.utility_reservations%rowtype;
begin
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if not found then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select target.*
  into reservation
  from public.utility_reservations as target
  where target.id = p_reservation_id
  for update;

  if not found or reservation.profile_id <> caller_profile_id then
    raise exception 'reservation not found'
      using errcode = '42501';
  end if;

  korea_today := (now() at time zone 'Asia/Seoul')::date;

  if reservation.recurring = false then
    if reservation.reservation_date < korea_today then
      raise exception 'past utility reservations cannot be cancelled'
        using errcode = '22023';
    end if;

    delete from public.utility_reservations
    where id = reservation.id;
    return;
  end if;

  if p_effective_date is null
    or p_effective_date < korea_today
    or p_effective_date < reservation.reservation_date
    or extract(dow from p_effective_date)
      <> extract(dow from reservation.reservation_date)
  then
    raise exception 'invalid recurring cancellation date'
      using errcode = '22023';
  end if;

  update public.utility_reservations
  set recurring_until = least(
    coalesce(recurring_until, p_effective_date),
    p_effective_date
  )
  where id = reservation.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.clear_comment_reaction (
  p_comment_id uuid
)
  RETURNS TABLE (
    reaction_count integer,
    top_reactions  public.post_reaction[],
    my_reaction    public.post_reaction
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_post_id uuid;
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

  perform private.lock_reaction_context(target_post_id, caller_profile_id);

  perform 1
  from public.post_comments as comment
  where comment.id = p_comment_id
    and comment.post_id = target_post_id
    and comment.deleted_at is null
  for update;
  if not found then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  delete from public.comment_reactions as target
  where target.comment_id = p_comment_id and target.profile_id = caller_profile_id;

  return query select * from private.comment_reaction_summary(p_comment_id, caller_profile_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.clear_post_reaction (
  p_post_id uuid
)
  RETURNS TABLE (
    reaction_count integer,
    top_reactions  public.post_reaction[],
    my_reaction    public.post_reaction
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  perform private.lock_reaction_context(p_post_id, caller_profile_id);

  delete from public.post_reactions as target
  where target.post_id = p_post_id and target.profile_id = caller_profile_id;

  return query select * from private.post_reaction_summary(p_post_id, caller_profile_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_post_comment (
  p_post_id           uuid,
  p_body              text,
  p_author_identity   public.post_identity,
  p_parent_comment_id uuid                 DEFAULT NULL::uuid,
  p_image_id          uuid                 DEFAULT NULL::uuid
)
  RETURNS TABLE (
    comment_id          uuid,
    post_id             uuid,
    parent_comment_id   uuid,
    root_comment_id     uuid,
    depth               smallint,
    body                text,
    author_identity     public.post_identity,
    author_pub_id       text,
    author_name         text,
    author_avatar_path  text,
    author_label        text,
    created_at          timestamp with time zone,
    edited_at           timestamp with time zone,
    is_deleted          boolean,
    is_author           boolean,
    can_edit            boolean,
    can_delete          boolean,
    reply_count         integer,
    reaction_count      integer,
    top_reactions       public.post_reaction[],
    my_reaction         public.post_reaction,
    parent_author_label text
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

ALTER FUNCTION public.get_my_profile() SECURITY DEFINER;

CREATE FUNCTION public.get_accepted_profile(p_pub_id text)
  RETURNS TABLE (
    id bigint,
    pub_id text,
    name text,
    role public.app_role,
    type public.profile_type,
    student_number text,
    class_no smallint,
    cohort smallint,
    gender public.profile_gender,
    academic_track public.profile_academic_track,
    phone_number text,
    avatar_path text,
    birthday date,
    description text,
    dorm_room smallint,
    allow_timeline_posts boolean,
    cover_path text,
    contact_email text,
    department text,
    is_returning_student boolean
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select
    target.id, target.pub_id, target.name, target.role, target.type,
    target.student_number, target.class_no, target.cohort, target.gender,
    target.academic_track, target.phone_number, target.avatar_path,
    target.birthday, target.description, target.dorm_room,
    target.allow_timeline_posts, target.cover_path, target.contact_email,
    target.department, target.is_returning_student
  from public.profiles as target
  where lower(target.pub_id) = lower(btrim(p_pub_id))
    and target.status = 'accepted'
    and target.deleted_at is null
    and exists (
      select 1
      from public.profiles as viewer
      where viewer.auth_user_id = auth.uid()
        and viewer.status = 'accepted'
        and viewer.deleted_at is null
    );
$function$;

REVOKE ALL ON FUNCTION public.get_accepted_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_accepted_profile(text) TO authenticated;

ALTER FUNCTION public.discover_groups(text, boolean, smallint, bigint, uuid, integer)
SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.set_comment_reaction (
  p_comment_id uuid,
  p_reaction   public.post_reaction
)
  RETURNS TABLE (
    reaction_count integer,
    top_reactions  public.post_reaction[],
    my_reaction    public.post_reaction
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_post_id uuid;
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
  perform private.lock_reaction_context(target_post_id, caller_profile_id);

  perform 1
  from public.post_comments as comment
  where comment.id = p_comment_id
    and comment.post_id = target_post_id
    and comment.deleted_at is null
  for update;
  if not found then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  insert into public.comment_reactions as target (comment_id, profile_id, reaction)
  values (p_comment_id, caller_profile_id, p_reaction)
  on conflict (comment_id, profile_id) do update
  set reaction = excluded.reaction, created_at = now()
  where target.reaction is distinct from excluded.reaction;
  return query select * from private.comment_reaction_summary(p_comment_id, caller_profile_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_my_profile_media (
  p_slot        text,
  p_object_path text
)
  RETURNS public.profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  current_profile public.profiles;
  updated_profile public.profiles;
  activity_post_id uuid := gen_random_uuid();
  activity_kind public.profile_media_activity_kind;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_slot not in ('avatar', 'cover') then
    raise exception 'invalid profile media slot' using errcode = '22023';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;

  if current_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if not private.is_own_profile_media_path(p_object_path)
    or split_part(p_object_path, '/', 2) <> p_slot then
    raise exception 'invalid profile media path' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'profile-media'
      and object.name = p_object_path
      and object.owner_id = caller_id::text
  ) then
    raise exception 'uploaded profile media required' using errcode = '22023';
  end if;

  if (p_slot = 'avatar' and current_profile.avatar_path = p_object_path)
    or (p_slot = 'cover' and current_profile.cover_path = p_object_path) then
    return current_profile;
  end if;

  if p_slot = 'avatar' then
    activity_kind := 'avatar_changed';
    update public.profiles
    set avatar_path = p_object_path
    where id = current_profile.id
    returning * into updated_profile;
  else
    activity_kind := 'cover_changed';
    update public.profiles
    set cover_path = p_object_path
    where id = current_profile.id
    returning * into updated_profile;
  end if;

  insert into public.posts (
    id,
    kind,
    body,
    timeline_profile_id,
    author_identity,
    display_author_profile_id,
    visibility,
    published_at,
    activity_kind,
    activity_media_path
  ) values (
    activity_post_id,
    'profile',
    '',
    current_profile.id,
    'identified',
    current_profile.id,
    'public',
    now(),
    activity_kind,
    p_object_path
  );

  insert into private.post_authors (post_id, profile_id)
  values (activity_post_id, current_profile.id);

  return updated_profile;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_post_reaction (
  p_post_id  uuid,
  p_reaction public.post_reaction
)
  RETURNS TABLE (
    reaction_count integer,
    top_reactions  public.post_reaction[],
    my_reaction    public.post_reaction
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  perform private.lock_reaction_context(p_post_id, caller_profile_id);
  insert into public.post_reactions as target (post_id, profile_id, reaction)
  values (p_post_id, caller_profile_id, p_reaction)
  on conflict (post_id, profile_id) do update
  set reaction = excluded.reaction, created_at = now()
  where target.reaction is distinct from excluded.reaction;
  return query select * from private.post_reaction_summary(p_post_id, caller_profile_id);
end;
$function$;

CREATE POLICY gongang_schedule_delete_manager ON public.gongang_schedule
  FOR DELETE
  TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM public.profile_permissions permission
  WHERE ((permission.profile_id = private.current_profile_id()) AND (permission.permission_key = 'gongang.manage'::text)))) AND
    ((schedule_date >= (((now() AT TIME ZONE 'Asia/Seoul'::text))::date + (8 - (EXTRACT(isodow FROM ((now() AT TIME ZONE 'Asia/Seoul'::text))::date))::integer))) AND (schedule_date
    <= (((now() AT TIME ZONE 'Asia/Seoul'::text))::date + (14 - (EXTRACT(isodow FROM ((now() AT TIME ZONE 'Asia/Seoul'::text))::date))::integer))))));

CREATE POLICY gongang_schedule_insert_manager ON public.gongang_schedule
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profile_permissions permission
  WHERE ((permission.profile_id = private.current_profile_id()) AND (permission.permission_key = 'gongang.manage'::text)))));

CREATE POLICY gongang_schedule_select ON public.gongang_schedule
  FOR SELECT
  TO authenticated
  USING ((private.current_profile_id() IS NOT NULL));

CREATE POLICY gongang_schedule_update_manager ON public.gongang_schedule
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.profile_permissions permission
  WHERE ((permission.profile_id = private.current_profile_id()) AND (permission.permission_key = 'gongang.manage'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profile_permissions permission
  WHERE ((permission.profile_id = private.current_profile_id()) AND (permission.permission_key = 'gongang.manage'::text)))));

CREATE POLICY groups_select_visible ON public.groups
  FOR SELECT
  TO authenticated
  USING (((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.profiles profile
  WHERE
    ((profile.id = private.current_profile_id()) AND (((profile.type = ANY (ARRAY['student'::public.profile_type, 'alumni'::public.profile_type])) AND ((groups.kind =
    'official'::public.group_kind) OR ((groups.kind = 'unofficial'::public.group_kind) AND (groups.join_policy <> 'invite_only'::public.group_join_policy)))) OR
    ((groups.kind = 'unofficial'::public.group_kind) AND private.is_group_member(groups.id))))))));

CREATE POLICY permissions_select ON public.permissions
  FOR SELECT
  TO authenticated
  USING ((private.current_profile_id() IS NOT NULL));

CREATE POLICY profile_permissions_select_own ON public.profile_permissions
  FOR SELECT
  TO authenticated
  USING ((profile_id = private.current_profile_id()));

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_description_length CHECK (description IS NULL OR char_length(description) <= 500);

ALTER TABLE public.posts
  ADD CONSTRAINT posts_profile_activity_shape CHECK (
    activity_kind IS NULL
    OR (
      kind = 'profile'
      AND timeline_profile_id = display_author_profile_id
      AND visibility = 'public'
      AND body = ''
      AND published_at IS NOT NULL
      AND activity_media_path ~ (
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
        || CASE activity_kind
          WHEN 'avatar_changed' THEN 'avatar'
          WHEN 'cover_changed' THEN 'cover'
        END
        || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
    )
  );

CREATE TRIGGER posts_validate_profile_activity_path
  BEFORE INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_profile_activity_path();

REVOKE SELECT ON public.profiles FROM authenticated;

GRANT SELECT
  (academic_track, allow_timeline_posts, avatar_path, birthday, class_no, cohort, contact_email, cover_path, department, description, dorm_room, gender, id, is_returning_student,
  name, phone_number, pub_id, ROLE, student_number, TYPE) ON public.profiles TO authenticated;

ALTER TABLE public.user_timetables
  ADD CONSTRAINT user_timetables_json_check CHECK (private.is_valid_timetable_semesters(semesters));

CREATE TRIGGER user_timetables_set_updated_at
  BEFORE INSERT OR UPDATE ON public.user_timetables
  FOR EACH ROW
  EXECUTE FUNCTION private.set_updated_at();

CREATE POLICY user_timetables_insert_own ON public.user_timetables
  FOR INSERT
  TO authenticated
  WITH CHECK ((profile_id = private.current_profile_id()));

CREATE POLICY user_timetables_select_own ON public.user_timetables
  FOR SELECT
  TO authenticated
  USING ((profile_id = private.current_profile_id()));

CREATE POLICY user_timetables_update_own ON public.user_timetables
  FOR UPDATE
  TO authenticated
  USING ((profile_id = private.current_profile_id()))
  WITH CHECK ((profile_id = private.current_profile_id()));

CREATE POLICY utility_reservations_insert ON public.utility_reservations
  FOR INSERT
  TO authenticated
  WITH CHECK ((profile_id = private.current_profile_id()));

CREATE POLICY utility_reservations_select ON public.utility_reservations
  FOR SELECT
  TO authenticated
  USING ((private.current_profile_id() IS NOT NULL));

REVOKE ALL ON SEQUENCE public.profiles_id_seq
FROM anon, authenticated, service_role;

GRANT USAGE ON SEQUENCE public.profiles_id_seq TO service_role;

REVOKE ALL ON SEQUENCE public.utility_reservations_id_seq
FROM anon, authenticated, service_role;

GRANT USAGE ON SEQUENCE public.utility_reservations_id_seq
TO authenticated, service_role;

DROP POLICY profile_media_select_accepted ON storage.objects;

CREATE POLICY profile_media_select_accepted
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'profile-media'
  AND storage.allow_any_operation(ARRAY[
    'object.get_authenticated_info',
    'object.get_authenticated',
    'object.sign',
    'object.sign_many'
  ])
  AND private.can_read_profile_media_path(name)
);
