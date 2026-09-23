create table public.utility_reservations (
  id bigint generated always as identity primary key,

  profile_id bigint not null
    references public.profiles (id)
    on delete cascade,

  mode text not null,
  reservation_date date not null,
  slot text not null,
  location text,

  detail text not null,
  recurring boolean not null default false,

  applicant_name text not null,
  avatar_path text,

  created_at timestamptz not null default now(),

  constraint utility_reservations_mode_check
    check (
      mode in ('gongang', 'karaoke')
    ),

  constraint utility_reservations_detail_check
    check (
      char_length(btrim(detail))
      between 1 and 200
    ),

  constraint utility_reservations_location_check
    check (
      (
        mode = 'gongang'
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
    ),

  constraint utility_reservations_recurring_check
    check (
      recurring = false
      or mode = 'gongang'
    )
);


create index utility_reservations_date_idx
on public.utility_reservations (
  reservation_date
);


create function private.prepare_utility_reservation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  caller_profile public.profiles%rowtype;
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

  if new.mode = 'karaoke' then
    new.location := null;
    new.recurring := false;
  end if;

  lock_key :=
    pg_catalog.hashtextextended(
      pg_catalog.concat_ws(
        '|',
        new.mode,
        new.slot,
        coalesce(
          new.location,
          ''
        ),
        (
          extract(
            dow
            from new.reservation_date
          )::integer
        )::text
      ),
      0
    );

  perform pg_catalog.pg_advisory_xact_lock(
    lock_key
  );

  if exists (
    select 1
    from public.utility_reservations
      as reservation
    where reservation.mode = new.mode
      and reservation.slot = new.slot
      and reservation.location
        is not distinct from new.location
      and (
        (
          reservation.recurring = false
          and new.recurring = false
          and reservation.reservation_date
            = new.reservation_date
        )
        or
        (
          reservation.recurring = true
          and new.recurring = false
          and new.reservation_date
            >= reservation.reservation_date
          and extract(
            dow
            from new.reservation_date
          ) = extract(
            dow
            from reservation.reservation_date
          )
        )
        or
        (
          reservation.recurring = false
          and new.recurring = true
          and reservation.reservation_date
            >= new.reservation_date
          and extract(
            dow
            from reservation.reservation_date
          ) = extract(
            dow
            from new.reservation_date
          )
        )
        or
        (
          reservation.recurring = true
          and new.recurring = true
          and extract(
            dow
            from reservation.reservation_date
          ) = extract(
            dow
            from new.reservation_date
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


create trigger utility_reservations_prepare
before insert
on public.utility_reservations
for each row
execute function
  private.prepare_utility_reservation();


alter table
  public.utility_reservations
enable row level security;


create policy
  "utility_reservations_select"
on public.utility_reservations
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles as profile
    where profile.auth_user_id
      = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
  )
);


create policy
  "utility_reservations_insert"
on public.utility_reservations
for insert
to authenticated
with check (
  profile_id = (
    select profile.id
    from public.profiles as profile
    where profile.auth_user_id
      = (select auth.uid())
      and profile.status = 'accepted'
      and profile.deleted_at is null
  )
);


create policy
  "utility_reservations_delete_own"
on public.utility_reservations
for delete
to authenticated
using (
  profile_id = (
    select profile.id
    from public.profiles as profile
    where profile.auth_user_id
      = (select auth.uid())
      and profile.deleted_at is null
  )
);


revoke all
on table public.utility_reservations
from anon, authenticated;

grant
  select,
  insert,
  delete
on table public.utility_reservations
to authenticated;

grant usage, select
on sequence
  public.utility_reservations_id_seq
to authenticated;
