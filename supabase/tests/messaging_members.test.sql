begin;

create extension if not exists pgtap with schema extensions;
select plan(29);

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
  (select can_delete from public.list_conversations((select id from made where name = 'group'))),
  true,
  'the creator owns the group and can delete it'
);

select is(
  (select can_delete from public.list_conversations('c0000000-0000-0000-0000-000000000001')),
  false,
  'a direct conversation cannot be deleted'
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

-- 그룹 지우기. 다른 멤버를 내보내는 기능은 없고, 소유주만 그룹을 지운다.

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000302', true);
set local role authenticated;

select throws_ok(
  $$select public.delete_group_conversation((select id from made where name = 'group'))$$,
  '42501',
  null,
  'an ordinary member cannot delete the group'
);

-- 소유주가 나가면 가장 먼저 들어온 남은 멤버가 소유주가 된다.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
insert into made
select 'handover', public.create_group_conversation(
  '넘김', array[(select minjun from ids), (select saebyeok from ids)]
);
select public.leave_conversation((select id from made where name = 'handover'));
reset role;

select is(
  (select created_by from public.conversations where id = (select id from made where name = 'handover')),
  (
    select member.profile_id
    from public.conversation_members as member
    where member.conversation_id = (select id from made where name = 'handover')
      and member.left_at is null
    order by member.joined_at, member.id
    limit 1
  ),
  'when the owner leaves, the earliest remaining member becomes the owner'
);

-- 넘겨받은 소유주가 그룹을 지우면 대화가 모두에게서 사라지고 첨부 object는 정리 큐로 간다.
insert into private.message_attachments (
  conversation_id, message_id, uploader_id, status, position, kind, mime_type, size_bytes,
  object_path, filename_ciphertext, key_version
)
select id, gen_random_uuid(), (select minjun from ids), 'pending', 0, 'file', 'application/pdf', 4,
  id::text || '/handover-file', '\x00', 1
from made where name = 'handover';

select set_config(
  'request.jwt.claim.sub',
  (
    select profile.auth_user_id::text
    from public.profiles as profile
    join public.conversations as conversation on conversation.created_by = profile.id
    where conversation.id = (select id from made where name = 'handover')
  ),
  true
);
set local role authenticated;

select lives_ok(
  $$select public.delete_group_conversation((select id from made where name = 'handover'))$$,
  'the new owner can delete the group'
);
reset role;

select ok(
  not exists (select 1 from public.conversations where id = (select id from made where name = 'handover'))
    and exists (
      select 1 from private.storage_cleanup_queue
      where bucket = 'message-attachments'
        and object_path = (select id from made where name = 'handover')::text || '/handover-file'
    ),
  'a deleted group is gone and its attachment objects are queued for cleanup'
);

-- 앱 관리자도 소유주가 아니면 지울 수 없다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
insert into made
select 'admin', public.create_group_conversation(
  '관리', array[(select admin from ids), (select minjun from ids)]
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000301', true);
set local role authenticated;

select is(
  (select can_delete from public.list_conversations((select id from made where name = 'admin'))),
  false,
  'an app administrator who does not own the group is not offered deletion'
);

select throws_ok(
  $$select public.delete_group_conversation((select id from made where name = 'admin'))$$,
  '42501',
  null,
  'an app administrator cannot delete a group they do not own'
);

-- 나가기

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000100', true);
set local role authenticated;

select public.leave_conversation((select id from made where name = 'group'));

select ok(
  exists (select 1 from public.list_conversations((select id from made where name = 'group'))),
  'a member who left can still open the conversation by id'
);

select ok(
  not exists (
    select 1 from public.list_conversations()
    where conversation_id = (select id from made where name = 'group')
  ),
  'a member who left on their own no longer lists the conversation'
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
