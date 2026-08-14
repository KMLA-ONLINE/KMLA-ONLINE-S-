begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.profiles (name, type)
select '자동 공개 ID ' || number, 'teacher'
from generate_series(1, 50) as number;

select ok(
  (
    select bool_and(pub_id ~ '^[a-z0-9](?:[a-z0-9-]{3,13}[a-z0-9])$')
    from public.profiles
    where name like '자동 공개 ID %'
  ),
  'default profile public IDs have the required format'
);

select is(
  (
    select count(distinct lower(pub_id))
    from public.profiles
    where name like '자동 공개 ID %'
  ),
  50::bigint,
  'default profile public IDs are unique'
);

select throws_ok(
  $$insert into public.profiles (pub_id, name, type)
    values ('-invalid', '잘못된 공개 ID', 'teacher')$$,
  '23514',
  null,
  'profile public IDs must match the required format'
);

insert into public.profiles (pub_id, name, type)
values ('case-test', '대소문자 공개 ID', 'teacher');

select throws_ok(
  $$insert into public.profiles (pub_id, name, type)
    values ('case-test', '중복 공개 ID', 'teacher')$$,
  '23505',
  null,
  'profile public IDs are unique'
);

set local role authenticated;
select is(
  (
    select pub_id
    from public.profiles
    where pub_id = 'kim-admin'
  ),
  'kim-admin'::text,
  'authenticated users can read accepted profiles by public ID'
);

select * from finish();
rollback;
