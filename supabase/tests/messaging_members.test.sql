begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

-- seed: 홍길동(…0001), 김민준(…0100), 김관리(kim-admin, 앱 관리자), 박새벽, 이한별.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000301',
    'authenticated', 'authenticated', 'members-admin@kmla.hs.kr', '', now(),
    '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000302',
    'authenticated', 'authenticated', 'members-saebyeok@kmla.hs.kr', '', now(),
    '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
  );

update public.profiles set auth_user_id = '10000000-0000-0000-0000-000000000301'
where pub_id = 'kim-admin';
update public.profiles set auth_user_id = '10000000-0000-0000-0000-000000000302'
where pub_id = 'saebyeok-24';

create temp table ids as
select
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000001') as hong,
  (select id from public.profiles where auth_user_id = '10000000-0000-0000-0000-000000000100') as minjun,
  (select id from public.profiles where pub_id = 'kim-admin') as admin,
  (select id from public.profiles where pub_id = 'saebyeok-24') as saebyeok,
  (select id from public.profiles where pub_id = 'hanbyeol-25') as hanbyeol;
grant select on ids to authenticated;

create temp table made (name text primary key, id uuid);
grant all on made to authenticated;

-- 배지: seed에서 홍길동은 1:1 대화 1개, 그룹 대화 3개를 읽지 않았다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(public.get_my_unread_message_count(), 4, 'the badge sums unread messages across my conversations');
reset role;

-- 상대 찾기

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select ok(
  exists (select 1 from public.search_message_recipients('김 민') where name = '김민준')
    and not exists (select 1 from public.search_message_recipients('홍길동')),
  'recipient search ignores spaces and leaves out myself'
);

select is(
  (select count(*) from public.search_message_recipients('  ')),
  0::bigint,
  'a blank search returns nobody'
);

-- 1:1 대화

select is(
  public.open_direct_conversation((select minjun from ids)),
  'c0000000-0000-0000-0000-000000000001'::uuid,
  'opening a direct conversation with someone I already talk to returns that conversation'
);

insert into made select 'direct', public.open_direct_conversation((select admin from ids));

select results_eq(
  $$select type::text, participants @> jsonb_build_array(jsonb_build_object('id', (select admin from ids)))
    from public.list_conversations((select id from made where name = 'direct'))$$,
  $$values ('direct', true)$$,
  'a new direct conversation lists both people'
);

select throws_ok(
  $$select public.open_direct_conversation((select hong from ids))$$,
  '22023',
  null,
  'nobody opens a direct conversation with themselves'
);

-- 그룹 대화

insert into made
select 'group', public.create_group_conversation(
  '  축제 준비  ', array[(select minjun from ids), (select minjun from ids), (select saebyeok from ids)]
);

select results_eq(
  $$select name, jsonb_array_length(participants)
    from public.list_conversations((select id from made where name = 'group'))$$,
  $$values ('축제 준비'::text, 3)$$,
  'a group has its trimmed name and the creator plus distinct invitees'
);

select throws_ok(
  $$select public.create_group_conversation('', array[(select minjun from ids)])$$,
  '22023',
  null,
  'a group needs a name'
);

select throws_ok(
  $$select public.create_group_conversation('혼자', array[(select hong from ids)])$$,
  '22023',
  null,
  'a group needs someone besides the creator'
);

select is(
  (select can_manage_members from public.list_conversations((select id from made where name = 'group'))),
  true,
  'the creator can manage group members'
);

select is(
  (select can_manage_members from public.list_conversations('c0000000-0000-0000-0000-000000000001')),
  false,
  'direct conversations have no members to manage'
);

-- 초대

select public.add_conversation_members(
  (select id from made where name = 'group'),
  array[(select hanbyeol from ids), (select minjun from ids)]
);

select results_eq(
  $$select system_kind, system_profile_ids
    from public.list_messages((select id from made where name = 'group'))
    where system_kind is not null$$,
  $$values
    ('member_added'::text, array[(select hong from ids), (select minjun from ids), (select saebyeok from ids)]),
    ('member_added'::text, array[(select hong from ids), (select hanbyeol from ids)])$$,
  'creating and inviting leave system messages naming the inviter and only the new members'
);

select is(
  (select unread_count from public.list_conversations((select id from made where name = 'group'))),
  0,
  'system messages do not count as unread'
);

-- 상한

reset role;
insert into public.profiles (
  name, type, student_number, cohort, gender, academic_track, birthday, status
)
select
  '임시 ' || n, 'student', '97' || lpad(n::text, 4, '0'), 30, 'male', 'domestic',
  '2008-01-01', 'accepted'
from generate_series(1, 97) as n;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select public.add_conversation_members(
      (select id from made where name = 'group'),
      array(select id from public.profiles where name like '임시 %')
    )$$,
  '54000',
  null,
  'a group stops at 100 members'
);

select lives_ok(
  $$select public.add_conversation_members(
      (select id from made where name = 'group'),
      array(select id from public.profiles where name like '임시 %' order by id limit 96)
    )$$,
  'a group can fill up to exactly 100 members'
);

-- 이름 변경

select public.rename_conversation((select id from made where name = 'group'), '축제 기획');

select results_eq(
  $$select name from public.list_conversations((select id from made where name = 'group'))$$,
  $$values ('축제 기획'::text)$$,
  'any member can rename the group'
);

select results_eq(
  $$select system_name from public.list_messages((select id from made where name = 'group'))
    where system_kind = 'renamed'$$,
  $$values ('축제 기획'::text)$$,
  'renaming leaves a system message with the new name'
);

select throws_ok(
  $$select public.rename_conversation('c0000000-0000-0000-0000-000000000001', '1:1')$$,
  '42501',
  null,
  'a direct conversation has no name to change'
);

-- 내보내기

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000302', true);
set local role authenticated;

select throws_ok(
  $$select public.remove_conversation_member(
      (select id from made where name = 'group'), (select minjun from ids)
    )$$,
  '42501',
  null,
  'an ordinary member cannot remove others'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select public.remove_conversation_member(
  (select id from made where name = 'group'), (select saebyeok from ids)
);

select ok(
  (
    select participants @> jsonb_build_array(
      jsonb_build_object('id', (select saebyeok from ids), 'active', false)
    )
    from public.list_conversations((select id from made where name = 'group'))
  ),
  'a removed member stays in participants as inactive so their name still shows'
);

-- 내보낸 사람에게 내보낸 뒤의 메시지는 보이지 않는다.
select public.send_message(
  (select id from made where name = 'group'),
  'e0000000-0000-0000-0000-000000000501',
  '내보낸 뒤의 메시지'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000302', true);
set local role authenticated;

select ok(
  not exists (
    select 1 from public.list_messages((select id from made where name = 'group'))
    where id = 'e0000000-0000-0000-0000-000000000501'
  ),
  'a removed member cannot see later messages'
);

select throws_ok(
  $$select public.send_message(
      (select id from made where name = 'group'),
      'e0000000-0000-0000-0000-000000000502',
      '나는 아직 멤버야'
    )$$,
  '42501',
  null,
  'a removed member cannot send'
);

-- 앱 관리자는 만든 사람이 아니어도 내보낼 수 있다.
reset role;
insert into public.conversation_members (conversation_id, profile_id)
select id, (select admin from ids) from made where name = 'group';
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000301', true);
set local role authenticated;

select lives_ok(
  $$select public.remove_conversation_member(
      (select id from made where name = 'group'), (select hanbyeol from ids)
    )$$,
  'an app administrator can remove a member'
);

-- 나가기

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select public.leave_conversation((select id from made where name = 'group'));

select ok(
  exists (select 1 from public.list_conversations((select id from made where name = 'group'))),
  'a member who left still finds the conversation in their list'
);

select throws_ok(
  $$select public.leave_conversation((select id from made where name = 'group'))$$,
  '42501',
  null,
  'leaving twice fails'
);

select throws_ok(
  $$select public.leave_conversation('c0000000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'nobody leaves a direct conversation'
);

-- 시스템 메시지는 반응·답장 대상이 아니다.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select public.set_message_reaction(
      (select id from public.list_messages((select id from made where name = 'group'))
        where system_kind = 'renamed'),
      'like'
    )$$,
  'P0002',
  null,
  'system messages take no reactions'
);

select * from finish();

rollback;
