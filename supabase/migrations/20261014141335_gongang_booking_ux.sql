SET local check_function_bodies = off;

DROP POLICY "gongang_schedule_delete_manager" ON "public"."gongang_schedule";

DROP POLICY "gongang_schedule_insert_manager" ON "public"."gongang_schedule";

DROP POLICY "gongang_schedule_update_manager" ON "public"."gongang_schedule";

ALTER TABLE "public"."gongang_schedule"
  DROP CONSTRAINT "gongang_schedule_slot_check";

ALTER TABLE "public"."utility_reservations"
  DROP CONSTRAINT "utility_reservations_slot_check";

ALTER TABLE "public"."gongang_schedule"
  ADD COLUMN "recurring" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."gongang_schedule"
  ADD COLUMN "recurring_until" date;

CREATE OR REPLACE FUNCTION private.can_manage_gongang()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = private.current_profile_id()
      AND (profile.role = 'admin' OR EXISTS (
        SELECT 1 FROM public.profile_permissions AS permission
        WHERE permission.profile_id = profile.id AND permission.permission_key = 'gongang.manage'
      ))
  );
$function$;

CREATE OR REPLACE FUNCTION private.prepare_gongang_schedule()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  korea_today date;
  next_monday date;
  next_sunday date;
  lock_key bigint;
  preempted record;
begin
  caller_profile_id := private.current_profile_id();
  if not private.can_manage_gongang() then
    raise exception 'gongang manager permission required' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (
    old.schedule_date is distinct from new.schedule_date
    or old.slot is distinct from new.slot
    or old.location is distinct from new.location
  ) then
    raise exception 'gongang schedule keys cannot be changed'
      using errcode = '22023';
  end if;

  korea_today := (now() at time zone 'Asia/Seoul')::date;
  next_monday :=
    korea_today + (8 - extract(isodow from korea_today)::integer);
  next_sunday := next_monday + 6;

  if (new.schedule_date < next_monday or new.schedule_date > next_sunday)
    and not (tg_op = 'UPDATE' and old.recurring
      and new.recurring_until between next_monday and next_sunday
      and new.reserved = old.reserved and new.detail is not distinct from old.detail
      and new.recurring = old.recurring
      and (old.recurring_until is null or new.recurring_until <= old.recurring_until))
  then
    raise exception 'only next week can be configured'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then new.recurring_until := null; end if;
  if not new.reserved then new.recurring := false; new.recurring_until := null; end if;
  new.configured_by := caller_profile_id;
  new.updated_at := now();

  if new.reserved = false then
    new.detail := null;
  else
    new.detail := btrim(new.detail);
  end if;

  lock_key :=
    pg_catalog.hashtextextended(
      pg_catalog.concat_ws(
        '|',
        'gongang',
        new.slot,
        new.location,
        extract(dow from new.schedule_date)::integer::text
      ),
      0
    );

  perform pg_catalog.pg_advisory_xact_lock(lock_key);

  if new.reserved and exists (
    select 1 from public.gongang_schedule as other
    where other.reserved and other.slot = new.slot and other.location = new.location
      and (other.schedule_date, other.slot, other.location) <> (new.schedule_date, new.slot, new.location)
      and extract(dow from other.schedule_date) = extract(dow from new.schedule_date)
      and (case when other.recurring then coalesce(other.recurring_until, 'infinity'::date) else other.schedule_date + 1 end) > new.schedule_date
      and (case when new.recurring then coalesce(new.recurring_until, 'infinity'::date) else new.schedule_date + 1 end) > other.schedule_date
  ) then
    raise exception 'manager schedule is already occupied' using errcode = '23505';
  end if;

  if new.reserved and exists (
    select 1
    from public.utility_reservations as reservation
    where reservation.mode = 'gongang'
      and reservation.recurring = false
      and ((not new.recurring and reservation.reservation_date = new.schedule_date)
        or (new.recurring and reservation.reservation_date >= new.schedule_date
          and (new.recurring_until is null or reservation.reservation_date < new.recurring_until)
          and extract(dow from reservation.reservation_date) = extract(dow from new.schedule_date)))
      and reservation.slot = new.slot
      and reservation.location = new.location
  ) then
    raise exception 'reservation slot is already occupied'
      using errcode = '23505';
  end if;

  if new.reserved then
    for preempted in
      update public.utility_reservations as reservation
      set recurring_until = new.schedule_date
      where reservation.mode = 'gongang'
        and reservation.recurring = true
        and reservation.slot = new.slot
        and reservation.location = new.location
        and reservation.reservation_date <= new.schedule_date
        and (
          reservation.recurring_until is null
          or reservation.recurring_until > new.schedule_date
        )
        and extract(dow from reservation.reservation_date)
          = extract(dow from new.schedule_date)
      returning reservation.id, reservation.profile_id
    loop
      perform private.emit_notification(
        'gongang-preempted:' || preempted.id::text || ':' || new.schedule_date::text,
        preempted.profile_id, 'gongang_preempted', 'high', 'school', 'staff',
        caller_profile_id, '운영진', null,
        '관리자 선예약으로 장기 공강 예약이 종료되었습니다.',
        null, null, null, null, preempted.id
      );
    end loop;
  end if;

  return new;
end;
$function$;

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
    select min(case when schedule.recurring then greatest(schedule.schedule_date, new.reservation_date) else schedule.schedule_date end)
    into first_manager_date
    from public.gongang_schedule as schedule
    where schedule.reserved = true
      and schedule.slot = new.slot
      and schedule.location = new.location
      and (schedule.schedule_date >= new.reservation_date or schedule.recurring)
      and (schedule.recurring_until is null or schedule.recurring_until > new.reservation_date)
      and extract(dow from schedule.schedule_date)
        = extract(dow from new.reservation_date);

    if first_manager_date = new.reservation_date then
      raise exception 'reserved by gongang manager' using errcode = '23505';
    end if;
    new.recurring_until := first_manager_date;
  elsif new.mode = 'gongang' and exists (
    select 1
    from public.gongang_schedule as schedule
    where schedule.reserved = true
      and (schedule.schedule_date = new.reservation_date or (schedule.recurring
        and schedule.schedule_date <= new.reservation_date
        and (schedule.recurring_until is null or schedule.recurring_until > new.reservation_date)
        and extract(dow from schedule.schedule_date) = extract(dow from new.reservation_date)))
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

CREATE OR REPLACE FUNCTION public.save_gongang_schedule (
  p_entries jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  entry record;
  next_monday date := (now() at time zone 'Asia/Seoul')::date + (8 - extract(isodow from (now() at time zone 'Asia/Seoul')::date)::integer);
BEGIN
  IF NOT private.can_manage_gongang() THEN
    RAISE EXCEPTION 'gongang manager permission required' USING ERRCODE = '42501';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 392 THEN
    RAISE EXCEPTION 'invalid schedule batch' USING ERRCODE = '22023';
  END IF;
  FOR entry IN SELECT * FROM jsonb_to_recordset(p_entries) AS x(schedule_date date, slot text, location text, reserved boolean, detail text, recurring boolean)
    ORDER BY slot, location, schedule_date
  LOOP
    IF entry.schedule_date IS NULL OR entry.schedule_date < next_monday OR entry.schedule_date > next_monday + 6 THEN
      RAISE EXCEPTION 'only next week can be configured' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.concat_ws('|', 'gongang', entry.slot, entry.location, extract(dow from entry.schedule_date)::integer::text), 0));
    UPDATE public.gongang_schedule SET recurring_until = entry.schedule_date
      WHERE reserved AND recurring AND schedule_date < entry.schedule_date
        AND slot = entry.slot AND location = entry.location
        AND extract(dow from schedule_date) = extract(dow from entry.schedule_date)
        AND (recurring_until IS NULL OR recurring_until > entry.schedule_date);
    INSERT INTO public.gongang_schedule (schedule_date, slot, location, reserved, detail, recurring)
      VALUES (entry.schedule_date, entry.slot, entry.location, entry.reserved, CASE WHEN entry.reserved THEN entry.detail ELSE NULL END, coalesce(entry.recurring, false) AND entry.reserved)
      ON CONFLICT (schedule_date, slot, location) DO UPDATE
        SET reserved = excluded.reserved, detail = excluded.detail, recurring = excluded.recurring, recurring_until = NULL;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."save_gongang_schedule"(jsonb) FROM PUBLIC, "anon", "service_role";

ALTER TABLE "public"."gongang_schedule"
  ADD CONSTRAINT "gongang_schedule_meal_weekday_check"
    CHECK
    (((slot <> ALL (ARRAY['lunch'::text, 'dinner'::text])) OR ((EXTRACT(isodow FROM schedule_date) >= (1)::numeric) AND (EXTRACT(isodow FROM schedule_date) <= (5)::numeric))));

ALTER TABLE "public"."gongang_schedule"
  ADD CONSTRAINT "gongang_schedule_recurring_check" CHECK ((((NOT recurring) OR reserved) AND ((recurring_until IS NULL) OR (recurring AND (recurring_until >= schedule_date)))));

ALTER TABLE "public"."gongang_schedule"
  ADD CONSTRAINT "gongang_schedule_slot_check"
    CHECK
    ((slot = ANY (ARRAY['lunch'::text, 'dinner'::text, 'study-1'::text, 'honjeong-end'::text, 'study-2'::text, 'hour-8'::text, 'hour-9'::text, 'hour-10'::text, 'hour-11'::text,
    'hour-12'::text, 'hour-13'::text, 'hour-14'::text, 'hour-15'::text, 'hour-16'::text, 'hour-17'::text, 'hour-18'::text])));

ALTER TABLE "public"."utility_reservations"
  ADD CONSTRAINT "utility_reservations_slot_check"
    CHECK
    ((((mode = 'gongang'::text) AND (slot = ANY (ARRAY['study-1'::text, 'honjeong-end'::text, 'study-2'::text]))) OR ((mode = ANY (ARRAY['gongang'::text, 'karaoke'::text])) AND
    (slot = ANY (ARRAY['lunch'::text, 'dinner'::text])) AND ((EXTRACT(isodow FROM reservation_date) >= (1)::numeric) AND (EXTRACT(isodow FROM reservation_date) <= (5)::numeric)))
    OR
    ((mode = ANY (ARRAY['gongang'::text, 'karaoke'::text])) AND (slot = ANY (ARRAY['hour-8'::text, 'hour-9'::text, 'hour-10'::text, 'hour-11'::text, 'hour-12'::text,
    'hour-13'::text,
    'hour-14'::text, 'hour-15'::text, 'hour-16'::text, 'hour-17'::text, 'hour-18'::text])) AND (EXTRACT(isodow FROM reservation_date) = ANY (ARRAY[(6)::numeric, (7)::numeric])))));

CREATE POLICY "gongang_schedule_delete_manager" ON "public"."gongang_schedule"
  FOR DELETE
  TO "authenticated"
  USING
    ((private.can_manage_gongang() AND ((schedule_date >= (((now() AT TIME ZONE 'Asia/Seoul'::text))::date + (8 - (EXTRACT(isodow FROM ((now() AT TIME ZONE
    'Asia/Seoul'::text))::date))::integer))) AND
    (schedule_date <= (((now() AT TIME ZONE 'Asia/Seoul'::text))::date + (14 - (EXTRACT(isodow FROM ((now() AT TIME ZONE 'Asia/Seoul'::text))::date))::integer))))));

CREATE POLICY "gongang_schedule_insert_manager" ON "public"."gongang_schedule"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (private.can_manage_gongang());

CREATE POLICY "gongang_schedule_update_manager" ON "public"."gongang_schedule"
  FOR UPDATE
  TO "authenticated"
  USING (private.can_manage_gongang())
  WITH CHECK (private.can_manage_gongang());

REVOKE ALL ON FUNCTION "private"."can_manage_gongang"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_manage_gongang"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."save_gongang_schedule"(jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."save_gongang_schedule"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."save_gongang_schedule"(jsonb) TO "postgres";

-- 반복 선예약은 첫 날짜가 아니라 반복이 끝난 날부터 보존 기간을 센다.
create or replace function private.cleanup_expired_records()
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  removed bigint := 0;
  affected bigint;
  korea_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- 스토리는 만료되면 읽는 경로가 없다(기능 명세 §17.6). publish하지 못한 사진 스토리는 48시간을
  -- 기다린다. Storage 2층 스윕과 같은 유예라 업로드 중인 행을 지우지 않는다. 행을 지우는 문장이
  -- 이미지 경로를 정리 큐로 옮긴다.
  with expired as (
    delete from public.stories as story
    where (story.status = 'ready' and story.expires_at <= now())
      or (story.status = 'pending' and story.created_at <= now() - interval '48 hours')
    returning story.image_path, story.thumbnail_path
  ), queued as (
    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select 'story-media', path.object_path, 'story_media'
    from expired
    cross join lateral (
      values (expired.image_path), (expired.thumbnail_path)
    ) as path(object_path)
    where path.object_path is not null
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run
  )
  select count(*) into affected from expired;
  removed := removed + affected;

  -- 예약은 끝난 뒤 2주까지 남긴다. 반복 예약은 종료일이 정해지기 전까지 지우지 않는다.
  delete from public.utility_reservations as reservation
  where case
      when reservation.recurring then reservation.recurring_until
      else reservation.reservation_date
    end < korea_today - 14;
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- 관리자 반복 선예약도 같다. 첫 날짜가 지나도 반복이 끝나기 전에는 학생 예약을 막고 있다.
  delete from public.gongang_schedule as schedule
  where case
      when schedule.recurring then schedule.recurring_until
      else schedule.schedule_date
    end < korea_today - 14;
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- 랭킹 이벤트는 append-only 라 정리 경로임을 밝혀야 지울 수 있다(삭제 및 보존 정책 §7.4).
  perform pg_catalog.set_config('app.feed_event_purge', 'on', true);

  -- 반응 이벤트는 발행 후 6시간 이내 게시물에만 합산된다. 그보다 오래된 것은 어떤 조회에도 잡히지
  -- 않는다. 경계를 넉넉히 두려고 하루를 남긴다.
  delete from private.post_reaction_count_events
  where occurred_at < now() - interval '24 hours';
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- `#업` 이벤트는 게시물당 가장 최근 하나만 읽는다. 1시간 중복 방지 검사도 최근 구간만 보므로
  -- 최신 한 건을 남기면 두 조회가 모두 그대로 동작한다. 나머지는 죽은 데이터다.
  delete from private.feed_bump_events as bump
  where exists (
    select 1
    from private.feed_bump_events as newer
    where newer.post_id = bump.post_id
      and (newer.effective_at, newer.id) > (bump.effective_at, bump.id)
  );
  get diagnostics affected = row_count;
  removed := removed + affected;

  perform pg_catalog.set_config('app.feed_event_purge', 'off', true);

  return removed;
end;
$$;
