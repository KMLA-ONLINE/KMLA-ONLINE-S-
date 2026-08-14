begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(8);

do $$
begin
  perform extensions.dblink_connect(
    'race_create',
    'host=' || host(inet_server_addr())
      || ' port=' || inet_server_port()::text
      || ' dbname=' || current_database()
      || ' user=postgres password=postgres sslmode=disable'
  );
  perform extensions.dblink_connect(
    'race_accept',
    'host=' || host(inet_server_addr())
      || ' port=' || inet_server_port()::text
      || ' dbname=' || current_database()
      || ' user=postgres password=postgres sslmode=disable'
  );
  perform extensions.dblink_exec(
    'race_accept',
    $query$
      insert into public.profiles (
        pub_id,
        name,
        type,
        student_number,
        cohort,
        gender,
        academic_track,
        birthday,
        status
      ) values (
        'race-student',
        '동시 승인 학생',
        'student',
        '240096',
        29,
        'female',
        'domestic',
        '2007-01-05',
        'pending'
      )
    $query$
  );
  perform pg_catalog.pg_advisory_lock(4815162342);
end;
$$;

select is(
  extensions.dblink_send_query(
    'race_create',
    $query$
      insert into public.groups (
        id,
        slug,
        slug_is_custom,
        kind,
        name,
        join_policy,
        identity_policy,
        posting_policy,
        created_by
      ) values (
        '50000000-0000-0000-0000-000000000005',
        'race-official-check',
        true,
        'official',
        '동시성 공식 그룹',
        'open',
        'identified',
        'staff',
        (select id from public.profiles
         where pub_id = 'kim-admin')
      )
      returning id
    $query$
  ),
  1,
  'official group creation starts on an independent connection'
);

select is(
  extensions.dblink_send_query(
    'race_accept',
    $query$
      update public.profiles
      set status = 'accepted'
      where pub_id = 'race-student'
      returning id
    $query$
  ),
  1,
  'student acceptance starts on an independent connection'
);

select ok(
  extensions.dblink_is_busy('race_create') = 1
    and extensions.dblink_is_busy('race_accept') = 1,
  'both competing transactions wait behind the shared advisory lock'
);

do $$
begin
  perform pg_catalog.pg_advisory_unlock(4815162342);
end;
$$;

select is(
  (
    select id
    from extensions.dblink_get_result('race_create') as result(id uuid)
  ),
  '50000000-0000-0000-0000-000000000005'::uuid,
  'concurrent official group creation completes'
);

select isnt(
  (
    select id
    from extensions.dblink_get_result('race_accept') as result(id bigint)
  ),
  null::bigint,
  'concurrent student acceptance completes'
);

-- Async dblink connections require one final empty result before reuse.
do $$
begin
  perform result.id
  from extensions.dblink_get_result('race_create') as result(id uuid);
  perform result.id
  from extensions.dblink_get_result('race_accept') as result(id bigint);
end;
$$;

select is(
  (
    select count(*)
    from public.group_memberships
    where group_id = '50000000-0000-0000-0000-000000000005'
      and profile_id = (
        select id from public.profiles
        where pub_id = 'race-student'
      )
  ),
  1::bigint,
  'group creation and student acceptance cannot miss auto-membership'
);

select is(
  extensions.dblink_exec(
    'race_create',
    $$delete from public.groups
      where id = '50000000-0000-0000-0000-000000000005'$$
  ),
  'DELETE 1',
  'concurrency test group is removed'
);

select is(
  extensions.dblink_exec(
    'race_accept',
    $$delete from public.profiles
      where pub_id = 'race-student'$$
  ),
  'DELETE 1',
  'concurrency test profile is removed'
);

do $$
begin
  perform extensions.dblink_disconnect('race_create');
  perform extensions.dblink_disconnect('race_accept');
end;
$$;

select * from finish();
rollback;
