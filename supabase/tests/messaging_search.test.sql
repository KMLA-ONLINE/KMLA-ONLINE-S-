begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- seed: 홍길동(…0001)과 김민준(…0100)의 1:1 대화 c…01. 그룹 c…02에서 이한별은 2026-08-21에 참여했다.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000401',
  'authenticated', 'authenticated', 'search-late@kmla.hs.kr', '', now(),
  '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
);
update public.profiles set auth_user_id = '10000000-0000-0000-0000-000000000401'
where pub_id = 'hanbyeol-25';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is(
  (select jsonb_path_query_array(
    public.search_messages('c0000000-0000-0000-0000-000000000001', '도 서 관'),
    '$.results[*].id'
  )),
  '["d0000000-0000-0000-0000-000000000001"]'::jsonb,
  'search ignores spaces and case and finds partial matches'
);

select is(
  public.search_messages('c0000000-0000-0000-0000-000000000001', '없는 말') -> 'results',
  '[]'::jsonb,
  'no match returns no results'
);

-- 호출자는 JWT claim으로 정해지므로 임시 테이블을 만들 수 있는 역할에서 보낸다.
reset role;
create temp table sent as
select id, sent_at
from public.send_message('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000601', '도서관 말고 카페');
grant select on sent to authenticated;
set local role authenticated;
select public.send_message('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000602', '도서관 지울 메시지');
select public.delete_messages(array['e0000000-0000-0000-0000-000000000602']::uuid[]);

select is(
  (select jsonb_path_query_array(
    public.search_messages('c0000000-0000-0000-0000-000000000001', '도서관'),
    '$.results[*].id'
  )),
  '["e0000000-0000-0000-0000-000000000601", "d0000000-0000-0000-0000-000000000001"]'::jsonb,
  'results come newest first and skip deleted messages'
);

select ok(
  (public.search_messages('c0000000-0000-0000-0000-000000000001', '도서관', null, null, 1)
    -> 'next_cursor') is not null,
  'reaching the result limit gives a cursor to continue'
);

select is(
  (select jsonb_path_query_array(
    public.search_messages(
      'c0000000-0000-0000-0000-000000000001', '도서관',
      (select sent_at from sent),
      'e0000000-0000-0000-0000-000000000601'
    ),
    '$.results[*].id'
  )),
  '["d0000000-0000-0000-0000-000000000001"]'::jsonb,
  'continuing from a cursor finds older matches'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000401', true);
set local role authenticated;

select is(
  public.search_messages('c0000000-0000-0000-0000-000000000002', '축제') -> 'results',
  '[]'::jsonb,
  'search never reaches messages from before joining'
);

select is(
  public.search_messages('c0000000-0000-0000-0000-000000000001', '도서관') -> 'results',
  '[]'::jsonb,
  'search finds nothing in a conversation I am not part of'
);

select * from finish();

rollback;
