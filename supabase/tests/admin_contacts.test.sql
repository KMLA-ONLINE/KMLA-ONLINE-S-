begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select ok(
  has_table_privilege('anon', 'public.admin_contacts', 'SELECT'),
  'signed-out visitors can read admin contacts'
);
select ok(
  not has_table_privilege('authenticated', 'public.admin_contacts', 'INSERT')
    and not has_table_privilege('authenticated', 'public.admin_contacts', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.admin_contacts', 'DELETE'),
  'clients cannot write admin contacts directly'
);
select ok(
  not has_function_privilege('anon', 'public.admin_replace_contacts(jsonb)', 'EXECUTE'),
  'signed-out visitors cannot replace admin contacts'
);

-- jung-teacher: accepted non-admin member
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000099', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_replace_contacts('[{"kind":"email","label":"메일","value":"a@b.kr"}]')$$,
  '42501', 'app administrator required',
  'a non-admin cannot replace admin contacts'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000098', true);
set local role authenticated;
select lives_ok(
  $$select public.admin_replace_contacts('[
    {"kind":"link","label":" 오픈채팅 ","value":"https://open.kakao.com/o/abc"},
    {"kind":"email","label":"학생회 메일","value":" council@kmla.hs.kr "}
  ]')$$,
  'an app admin can replace admin contacts'
);
select results_eq(
  $$select position::integer, kind, label, value from public.admin_contacts order by position$$,
  $$values (0, 'link', '오픈채팅', 'https://open.kakao.com/o/abc'),
           (1, 'email', '학생회 메일', 'council@kmla.hs.kr')$$,
  'contacts are stored in the submitted order with trimmed text'
);
select lives_ok(
  $$select public.admin_replace_contacts('[{"kind":"email","label":"학생회 메일","value":"council@kmla.hs.kr"}]')$$,
  'replacing again overwrites the whole list'
);
select is(
  (select count(*) from public.admin_contacts), 1::bigint,
  'the previous list is fully replaced'
);
select throws_ok(
  $$select public.admin_replace_contacts('[{"kind":"link","label":"사이트","value":"http://example.com"}]')$$,
  '23514', null,
  'links must use https'
);
select throws_ok(
  $$select public.admin_replace_contacts('[{"kind":"email","label":"메일","value":"not-an-email"}]')$$,
  '23514', null,
  'emails must look like an address'
);
select throws_ok(
  $$select public.admin_replace_contacts('[{"kind":"phone","label":"전화","value":"010"}]')$$,
  '23514', null,
  'unknown contact kinds are rejected'
);
select throws_ok(
  $$select public.admin_replace_contacts((select jsonb_agg(jsonb_build_object('kind','email','label','메일','value','a@b.kr')) from generate_series(1, 11)))$$,
  '22023', 'too many contacts',
  'at most ten contacts are allowed'
);
select is(
  (select count(*) from public.admin_contacts), 1::bigint,
  'a rejected replacement keeps the previous list'
);

reset role;
set local role anon;
select is(
  (select label from public.admin_contacts limit 1), '학생회 메일',
  'signed-out visitors see the saved contacts'
);

select * from finish();
rollback;
