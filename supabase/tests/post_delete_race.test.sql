begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(8);

do $$
declare
  connection text := 'host=' || host(inet_server_addr())
    || ' port=' || inet_server_port()::text
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect(
    'post_delete', connection || ' application_name=post_delete_race_delete'
  );
  perform extensions.dblink_connect(
    'post_mutation', connection || ' application_name=post_delete_race_mutation'
  );
end;
$$;

select is(
  extensions.dblink_exec(
    'post_delete',
    $query$
      insert into public.posts (
        id, kind, body, group_id, title, author_identity,
        display_author_profile_id, created_at, published_at
      ) values (
        'f0000000-0000-0000-0000-000000000001', 'group',
        'post deletion race fixture',
        '20000000-0000-0000-0000-000000000001',
        'post deletion race fixture', 'identified',
        (select id from public.profiles where pub_id = 'kim-admin'),
        '2026-08-24 00:00:00+00', '2026-08-24 00:00:00+00'
      )
    $query$
  ),
  'INSERT 0 1',
  'the race fixture is committed and visible to independent sessions'
);

do $$
begin
  perform extensions.dblink_exec(
    'post_delete',
    $config$set lock_timeout = '2s'; set statement_timeout = '4s';
      select set_config('request.jwt.claim.sub',
        '10000000-0000-0000-0000-000000000098', false);
      set role authenticated; begin$config$
  );
  perform extensions.dblink_exec(
    'post_mutation',
    $config$set lock_timeout = '2s'; set statement_timeout = '4s';
      select set_config('request.jwt.claim.sub',
        '10000000-0000-0000-0000-000000000001', false);
      set role authenticated$config$
  );
end;
$$;

select is(
  extensions.dblink_exec(
    'post_delete',
    $query$do $$ begin
        perform public.delete_group_post(
          'f0000000-0000-0000-0000-000000000001'
        );
      end $$;$query$
  ),
  'DO',
  'post deletion acquires the post lock without committing'
);

select is(
  extensions.dblink_send_query(
    'post_mutation',
    $$select reaction_count
      from public.set_post_reaction(
        'f0000000-0000-0000-0000-000000000001', 'like'
      )$$
  ),
  1,
  'the concurrent reaction starts on an independent connection'
);

create temp table race_state (mutation_waited boolean not null);
do $$
declare
  observed boolean := false;
  deadline timestamptz := clock_timestamp() + interval '2 seconds';
begin
  loop
    select exists (
      select 1
      from pg_catalog.pg_stat_activity
      where application_name = 'post_delete_race_mutation'
        and wait_event_type = 'Lock'
    ) into observed;
    exit when observed or clock_timestamp() >= deadline;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into race_state values (observed);
end;
$$;

select ok(
  (select mutation_waited from race_state),
  'the reaction waits on the deleting transaction post lock'
);

select is(
  extensions.dblink_exec('post_delete', 'commit'),
  'COMMIT',
  'post deletion commits before the waiting reaction continues'
);

select throws_ok(
  $$select *
    from extensions.dblink_get_result('post_mutation') as result(reaction_count integer)$$,
  'P0002',
  'post not found',
  'the waiting reaction fails after deletion wins'
);

select is(
  (
    select count(*)
    from public.post_reactions
    where post_id = 'f0000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'the failed mutation creates no child row'
);

select is(
  extensions.dblink_exec(
    'post_delete',
    $$reset role; delete from public.posts
      where id = 'f0000000-0000-0000-0000-000000000001'$$
  ),
  'DELETE 1',
  'the committed fixture is removed'
);

do $$
begin
  perform extensions.dblink_disconnect('post_delete');
  perform extensions.dblink_disconnect('post_mutation');
end;
$$;

select * from finish();
rollback;
