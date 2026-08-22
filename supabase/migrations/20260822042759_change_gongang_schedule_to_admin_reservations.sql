alter table public.gongang_schedule
rename column enabled to reserved;

alter table public.gongang_schedule
add column detail text;

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
    and char_length(btrim(detail)) between 1 and 200
  )
);


create function private.guard_gongang_schedule_conflicts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reserved = false then
    new.detail := null;
    return new;
  end if;

  new.detail := btrim(new.detail);

  if exists (
    select 1
    from public.utility_reservations as reservation
    where reservation.mode = 'gongang'
      and reservation.slot = new.slot
      and reservation.location
        is not distinct from new.location
      and (
        (
          reservation.recurring = false
          and reservation.reservation_date
            = new.schedule_date
        )
        or
        (
          reservation.recurring = true
          and new.schedule_date
            >= reservation.reservation_date
          and extract(
            dow from new.schedule_date
          ) = extract(
            dow from reservation.reservation_date
          )
        )
      )
  ) then
    raise exception
      'reservation slot is already occupied'
      using errcode = '23505';
  end if;

  return new;
end;
$$;


create trigger gongang_schedule_conflict_guard
before insert or update
on public.gongang_schedule
for each row
execute function
  private.guard_gongang_schedule_conflicts();


create function private.guard_utility_against_gongang_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mode = 'gongang'
    and exists (
      select 1
      from public.gongang_schedule as schedule
      where schedule.schedule_date
        = new.reservation_date
        and schedule.slot = new.slot
        and schedule.location
          is not distinct from new.location
        and schedule.reserved = true
    )
  then
    raise exception
      'reserved by gongang manager'
      using errcode = '23505';
  end if;

  return new;
end;
$$;


create trigger utility_reservations_gongang_guard
before insert
on public.utility_reservations
for each row
execute function
  private.guard_utility_against_gongang_schedule();
