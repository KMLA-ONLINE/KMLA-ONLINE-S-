create or replace function private.guard_utility_against_gongang_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mode = 'gongang'
    and exists (
      select 1
      from public.gongang_schedule as schedule
      where schedule.reserved = true
        and schedule.slot = new.slot
        and schedule.location
          is not distinct from new.location
        and (
          (
            new.recurring = false
            and schedule.schedule_date
              = new.reservation_date
          )
          or
          (
            new.recurring = true
            and schedule.schedule_date
              >= new.reservation_date
            and extract(
              dow from schedule.schedule_date
            ) = extract(
              dow from new.reservation_date
            )
          )
        )
    )
  then
    raise exception
      'reserved by gongang manager'
      using errcode = '23505';
  end if;

  return new;
end;
$$;
