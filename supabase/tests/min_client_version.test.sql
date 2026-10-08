begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

select ok(public.min_client_version() >= 1, 'min_client_version returns a positive version');

-- 로그인 전 화면에서도 옛 앱을 막아야 하므로 anon도 부를 수 있어야 한다.
select ok(
  has_function_privilege('anon', 'public.min_client_version()', 'execute'),
  'anon can read the minimum client version'
);
select ok(
  has_function_privilege('authenticated', 'public.min_client_version()', 'execute'),
  'authenticated can read the minimum client version'
);
select ok(
  not exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'min_client_version'
      and grantee = 'PUBLIC'
  ),
  'PUBLIC has no direct execute grant'
);

select * from finish();
rollback;
