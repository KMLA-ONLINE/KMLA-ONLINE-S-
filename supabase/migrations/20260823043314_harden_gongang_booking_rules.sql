alter table public.utility_reservations
add column recurring_until date;

comment on column public.utility_reservations.recurring_until is
  'Exclusive end date for a recurring reservation. NULL means no scheduled end.';

alter table public.utility_reservations
drop constraint utility_reservations_location_check;

alter table public.utility_reservations
add constraint utility_reservations_location_check
check (
  (
    mode = 'gongang'
    and location is not null
    and location in (
      'floor_b1',
      'floor_2',
      'floor_4',
      'floor_10'
    )
  )
  or
  (
    mode = 'karaoke'
    and location is null
  )
);

alter table public.utility_reservations
add constraint utility_reservations_slot_check
check (
  (
    mode = 'gongang'
    and (
      slot in ('study-1', 'honjeong-end', 'study-2')
      or (
        slot in (
          'hour-8', 'hour-9', 'hour-10', 'hour-11',
          'hour-12', 'hour-13', 'hour-14', 'hour-15',
          'hour-16', 'hour-17', 'hour-18'
        )
        and extract(isodow from reservation_date) in (6, 7)
      )
    )
  )
  or
  (
    mode = 'karaoke'
    and (
      (
        slot in ('lunch', 'dinner')
        and extract(isodow from reservation_date) between 1 and 5
      )
      or (
        slot in (
          'hour-8', 'hour-9', 'hour-10', 'hour-11',
          'hour-12', 'hour-13', 'hour-14', 'hour-15',
          'hour-16', 'hour-17', 'hour-18'
        )
        and extract(isodow from reservation_date) in (6, 7)
      )
    )
  )
);

alter table public.gongang_schedule
drop constraint gongang_schedule_detail_check;

alter table public.gongang_schedule
add constraint gongang_schedule_detail_check
check (
  (
    reserved = false
    and detail is null
  )
  or
  (
    reserved = true
    and detail is not null
    and char_length(btrim(detail)) between 1 and 200
  )
);

alter table public.gongang_schedule
add constraint gongang_schedule_hourly_weekend_check
check (
  slot not like 'hour-%'
  or extract(isodow from schedule_date) in (6, 7)
);

drop trigger utility_reservations_gongang_guard
on public.utility_reservations;

drop function private.guard_utility_against_gongang_schedule();

drop trigger gongang_schedule_conflict_guard
on public.gongang_schedule;

drop function private.guard_gongang_schedule_conflicts();

create or replace function private.prepare_utility_reservation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  caller_profile public.profiles%rowtype;
  korea_today date;
  current_monday date;
  first_manager_date date;
  lock_key bigint;
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if not found then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  new.profile_id := caller_profile.id;
  new.applicant_name := caller_profile.name;
  new.avatar_path := caller_profile.avatar_path;
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
$$;

create or replace function private.prepare_gongang_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint;
  korea_today date;
  next_monday date;
  next_sunday date;
  lock_key bigint;
begin
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  join public.profile_permissions as permission
    on permission.profile_id = profile.id
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and permission.permission_key = 'gongang.manage';

  if not found then
    raise exception 'gongang manager permission required'
      using errcode = '42501';
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

  if new.schedule_date < next_monday
    or new.schedule_date > next_sunday
  then
    raise exception 'only next week can be configured'
      using errcode = '22023';
  end if;

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
    select 1
    from public.utility_reservations as reservation
    where reservation.mode = 'gongang'
      and reservation.recurring = false
      and reservation.reservation_date = new.schedule_date
      and reservation.slot = new.slot
      and reservation.location = new.location
  ) then
    raise exception 'reservation slot is already occupied'
      using errcode = '23505';
  end if;

  if new.reserved then
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
        = extract(dow from new.schedule_date);
  end if;

  return new;
end;
$$;

create or replace function public.cancel_utility_reservation(
  p_reservation_id bigint,
  p_effective_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  if reservation.recurring = false then
    delete from public.utility_reservations
    where id = reservation.id;
    return;
  end if;

  korea_today := (now() at time zone 'Asia/Seoul')::date;

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
$$;

revoke delete
on table public.utility_reservations
from authenticated;

revoke all
on function public.cancel_utility_reservation(bigint, date)
from public, anon;

grant execute
on function public.cancel_utility_reservation(bigint, date)
to authenticated;

drop policy "gongang_schedule_delete_manager"
on public.gongang_schedule;

create policy "gongang_schedule_delete_manager"
on public.gongang_schedule
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles as profile
    join public.profile_permissions as permission
      on permission.profile_id = profile.id
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
      and permission.permission_key = 'gongang.manage'
  )
  and schedule_date between
    (
      (now() at time zone 'Asia/Seoul')::date
      + (8 - extract(isodow from (now() at time zone 'Asia/Seoul')::date)::integer)
    )
    and
    (
      (now() at time zone 'Asia/Seoul')::date
      + (14 - extract(isodow from (now() at time zone 'Asia/Seoul')::date)::integer)
    )
);
