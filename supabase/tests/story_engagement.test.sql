begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- 시드에는 로그인 가능한 계정이 하나뿐이다. 트랜잭션 안에서만 두 계정을 더 붙인다.
--   auth1 = 시드 학생(스토리 작성자)
--   auth2 = 교사(재학생 스토리를 보는 사람)
--   auth3 = kim-admin, 졸업생(재학생 스토리를 못 보는 사람)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'story-teacher@kmla.hs.kr', '', now(),
    '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003',
    'authenticated', 'authenticated', 'story-alumni@kmla.hs.kr', '', now(),
    '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
  );

insert into public.profiles (auth_user_id, pub_id, name, type, status)
values ('10000000-0000-0000-0000-000000000002', 'story-viewer', '스토리 보는 교사', 'teacher', 'accepted');

update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000003'
where pub_id = 'kim-admin';

select ok(
  not has_table_privilege('authenticated', 'public.story_views', 'SELECT')
    and not has_table_privilege('authenticated', 'public.story_reactions', 'SELECT'),
  'views and reactions are not directly readable'
);

create temp table story_ids (name text primary key, id bigint);
grant all on story_ids to authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select public.create_text_story('본 사람을 볼 스토리', 'blue');
select public.create_text_story('반응만 받은 스토리', 'green');

insert into story_ids
select case content when '본 사람을 볼 스토리' then 'seen' else 'reacted' end, story_id
from public.list_active_stories()
where content in ('본 사람을 볼 스토리', '반응만 받은 스토리');

select public.mark_story_viewed((select id from story_ids where name = 'seen'));

select is(
  (select count(*)::integer from public.list_story_viewers((select id from story_ids where name = 'seen'))),
  0,
  'author is not recorded as a viewer'
);

select throws_ok(
  $$select public.send_story_reaction((select id from story_ids where name = 'seen'), 'love')$$,
  '42501',
  null,
  'author cannot react to an own story'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select lives_ok(
  $$select public.mark_story_viewed((select id from story_ids where name = 'seen'))$$,
  'viewer records seeing a story'
);

-- 다시 봐도 한 줄이다(아래 'author sees each viewer once').
select public.mark_story_viewed((select id from story_ids where name = 'seen'));

-- 반응은 여러 번 보낼 수 있고 보낸 순서대로 쌓인다.
select lives_ok(
  $$select public.send_story_reaction((select id from story_ids where name = 'seen'), 'love'),
      public.send_story_reaction((select id from story_ids where name = 'seen'), 'haha')$$,
  'viewer can send several reactions'
);

select throws_ok(
  $$select * from public.list_story_viewers((select id from story_ids where name = 'seen'))$$,
  '42501',
  null,
  'only the author can read who saw a story'
);

-- 보지 않고 바로 반응해도 본 사람으로 남는다.
select lives_ok(
  $$select public.send_story_reaction((select id from story_ids where name = 'reacted'), 'wow')$$,
  'viewer can react without a separate view'
);

select lives_ok(
  $$select public.send_story_reaction((select id from story_ids where name = 'seen'), 'like')
    from generate_series(1, 28)$$,
  'viewer can send up to 30 reactions to one story'
);

select throws_ok(
  $$select public.send_story_reaction((select id from story_ids where name = 'seen'), 'like')$$,
  '54000',
  null,
  'a viewer cannot send more than 30 reactions to one story'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select throws_ok(
  $$select public.mark_story_viewed((select id from story_ids where name = 'seen'))$$,
  'P0002',
  null,
  'someone who cannot see the story cannot record a view'
);

select throws_ok(
  $$select public.send_story_reaction((select id from story_ids where name = 'seen'), 'love')$$,
  'P0002',
  null,
  'someone who cannot see the story cannot react'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

-- 한 번 본 사람은 한 줄이고, 보낸 반응은 보낸 순서대로다.
select is(
  (select row(count(*), max(name))::text
    from public.list_story_viewers((select id from story_ids where name = 'seen'))),
  row(1, '스토리 보는 교사')::text,
  'author sees each viewer once'
);

select is(
  (select reactions[1:3]
    from public.list_story_viewers((select id from story_ids where name = 'seen'))),
  array['love', 'haha', 'like']::public.post_reaction[],
  'author sees the reactions in the order they were sent'
);

select is(
  (select pub_id
    from public.list_story_viewers((select id from story_ids where name = 'reacted'))),
  'story-viewer',
  'reacting counts as seeing'
);

-- 정지된 작성자는 다른 스토리 경로처럼 본 사람 목록도 받지 못한다.
reset role;
insert into private.profile_suspensions (profile_id, reason)
select id, '스토리 테스트'
from public.profiles
where auth_user_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;

select throws_ok(
  $$select * from public.list_story_viewers((select id from story_ids where name = 'seen'))$$,
  '42501',
  null,
  'a suspended author cannot read who saw a story'
);

reset role;
delete from private.profile_suspensions
where profile_id = (
  select id from public.profiles
  where auth_user_id = '10000000-0000-0000-0000-000000000001'
);
set local role authenticated;

select public.delete_my_story((select id from story_ids where name = 'seen'));

reset role;

select is(
  (select count(*)::integer from public.story_views
    where story_id = (select id from story_ids where name = 'seen')),
  0,
  'views and reactions go away with the story'
);

select * from finish();

rollback;
