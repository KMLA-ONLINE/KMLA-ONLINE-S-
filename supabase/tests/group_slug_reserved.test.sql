begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- `/groups/` 아래 route 이름과 겹치는 주소는 그룹 주소로 쓸 수 없다. `new`는 4자 미만이라 형식 제약이 먼저 막는다.
create function pg_temp.insert_group(p_slug text) returns void
language sql as $$
  insert into public.groups (
    slug, slug_is_custom, kind, name, description,
    join_policy, identity_policy, posting_policy, created_by
  )
  values (
    p_slug, true, 'unofficial', '예약 주소 확인', '',
    'open', 'identified', 'members',
    (select id from public.profiles where pub_id = 'hanbyeol-25')
  );
$$;

select throws_ok(
  $$select pg_temp.insert_group('create')$$,
  '23514', null, 'create is reserved'
);
select throws_ok(
  $$select pg_temp.insert_group('discover')$$,
  '23514', null, 'discover is reserved'
);
select throws_ok(
  $$select pg_temp.insert_group('edit')$$,
  '23514', null, 'edit is reserved'
);
select throws_ok(
  $$select pg_temp.insert_group('group')$$,
  '23514', null, 'group is reserved'
);
select throws_ok(
  $$select pg_temp.insert_group('member-page')$$,
  '23514', null, 'member-page is reserved'
);
select throws_ok(
  $$select pg_temp.insert_group('report-page')$$,
  '23514', null, 'report-page is reserved'
);
select lives_ok(
  $$select pg_temp.insert_group('edits')$$,
  'a slug that only contains a reserved word is allowed'
);

select * from finish();
rollback;
