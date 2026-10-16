-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.

-- 학교 인트라넷 공지의 최신 목록 캐시. `sync-school-notices` 함수가 학교 계정으로 로그인해 읽은
-- 결과를 통째로 바꿔 넣는다. 학교 계정 아이디·비밀번호는 Vault(`school_notice_login_id`,
-- `school_notice_password`)에만 두고 테이블이나 로그에 남기지 않는다.

create table if not exists private.school_notices (
  post_id integer primary key,
  list_position smallint not null,
  category text not null,
  title text not null,
  author text not null,
  posted_on date not null,
  has_attachment boolean not null default false,
  -- 텍스트로만 보여 줄 본문. 학교 HTML은 동기화 함수가 걷어 내고 저장한다.
  body text not null default '',
  -- [{attachment_id, name, size}]. 파일은 받지 않고 학교 다운로드 주소를 만들 ID만 둔다.
  attachments jsonb not null default '[]'::jsonb,
  constraint school_notices_list_position_check check (list_position >= 0),
  constraint school_notices_attachments_check check (jsonb_typeof(attachments) = 'array')
);

alter table private.school_notices owner to postgres;

-- 한 행짜리 동기화 상태. 행은 첫 기록 때 생긴다.
create table if not exists private.school_notice_sync_state (
  id boolean primary key default true,
  account_updated_at timestamptz,
  last_requested_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  constraint school_notice_sync_state_singleton check (id)
);

alter table private.school_notice_sync_state owner to postgres;

-- 같은 이름이 있으면 값을 바꾸고 없으면 만든다. `vault.create_secret`은 이미 있는 이름에서 실패한다.
create or replace function private.put_vault_secret(p_name text, p_value text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  secret_id uuid;
begin
  select secret.id into secret_id
  from vault.secrets as secret
  where secret.name = p_name;

  if secret_id is null then
    perform vault.create_secret(p_value, p_name, '');
  else
    perform vault.update_secret(secret_id, p_value);
  end if;
end;
$$;
alter function private.put_vault_secret(text, text) owner to postgres;

create or replace function private.invoke_school_notice_sync(p_quiet boolean default false)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  project_url text;
  sync_secret text;
  request_id bigint;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'project_url';

  select decrypted_secret into sync_secret
  from vault.decrypted_secrets
  where name = 'school_notice_sync_secret';

  if project_url is null or sync_secret is null then
    if p_quiet then
      return null;
    end if;
    raise exception 'school notice sync vault configuration is missing'
      using errcode = '55000';
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/sync-school-notices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', sync_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request_id;

  -- 함수가 결과를 기록하지 못하면 last_attempt_at이 이 값보다 뒤처진다. 관리자 화면이 그 차이로
  -- "요청했지만 응답이 없음"을 보여준다.
  insert into private.school_notice_sync_state (id, last_requested_at)
  values (true, now())
  on conflict (id) do update set last_requested_at = excluded.last_requested_at;

  return request_id;
exception
  when others then
    -- 하위 트랜잭션이라 여기서 되감기면 위에서 건 pg_net 요청도 함께 사라진다.
    if p_quiet then
      return null;
    end if;
    raise;
end;
$$;
alter function private.invoke_school_notice_sync(boolean) owner to postgres;

-- 동기화 함수(service_role) 전용. 비밀번호를 돌려주므로 클라이언트 역할에는 절대 열지 않는다.
create or replace function public.school_notice_credentials()
returns table (login_id text, password text)
language sql stable security definer
set search_path = ''
as $$
  select login.decrypted_secret, password.decrypted_secret
  from vault.decrypted_secrets as login
  cross join vault.decrypted_secrets as password
  where login.name = 'school_notice_login_id'
    and password.name = 'school_notice_password';
$$;
alter function public.school_notice_credentials() owner to postgres;

-- 동기화 함수(service_role) 전용. 성공이면 목록을 통째로 바꾸고, 실패면 기존 목록을 그대로 두고
-- 오류만 기록한다. 학교에서 지운 공지는 다음 성공 때 함께 사라진다.
create or replace function public.record_school_notice_sync(p_notices jsonb, p_error text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_error is not null then
    insert into private.school_notice_sync_state (id, last_attempt_at, last_error, last_error_at)
    values (true, now(), left(p_error, 200), now())
    on conflict (id) do update
    set last_attempt_at = excluded.last_attempt_at,
      last_error = excluded.last_error,
      last_error_at = excluded.last_error_at;
    return;
  end if;

  if jsonb_typeof(p_notices) is distinct from 'array'
    or jsonb_array_length(p_notices) not between 1 and 50 then
    raise exception 'notices must be a non-empty array of at most 50 items'
      using errcode = '22023';
  end if;

  delete from private.school_notices where true;

  insert into private.school_notices (
    post_id, list_position, category, title, author, posted_on, has_attachment, body, attachments
  )
  select
    (item.value ->> 'postId')::integer,
    (item.ordinality - 1)::smallint,
    item.value ->> 'category',
    item.value ->> 'title',
    item.value ->> 'author',
    (item.value ->> 'postedOn')::date,
    coalesce((item.value ->> 'hasAttachment')::boolean, false),
    left(coalesce(item.value ->> 'body', ''), 50000),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'attachment_id', (file.value ->> 'attachmentId')::integer,
          'name', file.value ->> 'name',
          'size', coalesce((file.value ->> 'size')::bigint, 0)
        )
        order by file.ordinality
      )
      from jsonb_array_elements(
        case when jsonb_typeof(item.value -> 'attachments') = 'array'
          then item.value -> 'attachments' else '[]'::jsonb end
      ) with ordinality as file(value, ordinality)
    ), '[]'::jsonb)
  from jsonb_array_elements(p_notices) with ordinality as item(value, ordinality);

  insert into private.school_notice_sync_state (id, last_attempt_at, last_success_at)
  values (true, now(), now())
  on conflict (id) do update
  set last_attempt_at = excluded.last_attempt_at,
    last_success_at = excluded.last_success_at;
end;
$$;
alter function public.record_school_notice_sync(jsonb, text) owner to postgres;

-- 승인된 사용자의 학교 공지 화면. 승인 프로필이 없으면 빈 결과다.
create or replace function public.list_school_notices()
returns table (
  post_id integer,
  category text,
  title text,
  author text,
  posted_on date,
  has_attachment boolean,
  synced_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select
    notice.post_id,
    notice.category,
    notice.title,
    notice.author,
    notice.posted_on,
    notice.has_attachment,
    state.last_success_at
  from private.school_notices as notice
  left join private.school_notice_sync_state as state on state.id
  where private.current_profile_id() is not null
  order by notice.list_position;
$$;
alter function public.list_school_notices() owner to postgres;

-- 승인된 사용자의 공지 상세. 목록에서 빠진 공지는 열리지 않는다.
create or replace function public.get_school_notice(p_post_id integer)
returns table (
  post_id integer,
  category text,
  title text,
  author text,
  posted_on date,
  body text,
  attachments jsonb
)
language sql stable security definer
set search_path = ''
as $$
  select
    notice.post_id,
    notice.category,
    notice.title,
    notice.author,
    notice.posted_on,
    notice.body,
    notice.attachments
  from private.school_notices as notice
  where notice.post_id = p_post_id
    and private.current_profile_id() is not null;
$$;
alter function public.get_school_notice(integer) owner to postgres;

-- 관리자가 학교 계정을 바꾼다. 바꾼 즉시 동기화를 한 번 요청해 새 계정으로 로그인되는지 확인한다.
create or replace function public.admin_set_school_notice_account(p_login_id text, p_password text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  login_id text := btrim(coalesce(p_login_id, ''));
begin
  perform private.require_app_admin();

  if login_id = '' or length(login_id) > 100 then
    raise exception 'school id must be 1 to 100 characters' using errcode = '22023';
  end if;
  if coalesce(p_password, '') = '' or length(p_password) > 200 then
    raise exception 'school password must be 1 to 200 characters' using errcode = '22023';
  end if;

  perform private.put_vault_secret('school_notice_login_id', login_id);
  perform private.put_vault_secret('school_notice_password', p_password);

  insert into private.school_notice_sync_state (id, account_updated_at)
  values (true, now())
  on conflict (id) do update set account_updated_at = excluded.account_updated_at;

  perform private.invoke_school_notice_sync(p_quiet => true);
end;
$$;
alter function public.admin_set_school_notice_account(text, text) owner to postgres;

create or replace function public.admin_sync_school_notices()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_app_admin();
  perform private.invoke_school_notice_sync();
end;
$$;
alter function public.admin_sync_school_notices() owner to postgres;

-- 관리자 화면용 한 행 요약. 학교 아이디는 누구 계정인지 알 수 있게 보여주고 비밀번호는 돌려주지 않는다.
create or replace function public.admin_school_notice_status()
returns table (
  login_id text,
  account_configured boolean,
  sync_configured boolean,
  account_updated_at timestamptz,
  last_requested_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  notice_count integer
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_app_admin();

  return query
  select
    (select secret.decrypted_secret from vault.decrypted_secrets as secret
      where secret.name = 'school_notice_login_id'),
    exists (select 1 from vault.decrypted_secrets as secret
      where secret.name = 'school_notice_login_id')
      and exists (select 1 from vault.decrypted_secrets as secret
        where secret.name = 'school_notice_password'),
    exists (select 1 from vault.decrypted_secrets as secret
      where secret.name = 'project_url')
      and exists (select 1 from vault.decrypted_secrets as secret
        where secret.name = 'school_notice_sync_secret'),
    state.account_updated_at,
    state.last_requested_at,
    state.last_attempt_at,
    state.last_success_at,
    state.last_error,
    state.last_error_at,
    (select count(*)::integer from private.school_notices)
  from (select true as present) as anchor
  left join private.school_notice_sync_state as state on state.id;
end;
$$;
alter function public.admin_school_notice_status() owner to postgres;

revoke all on table private.school_notices from anon, authenticated;
revoke all on table private.school_notice_sync_state from anon, authenticated;

revoke all on function private.put_vault_secret(text, text) from public;
revoke all on function private.invoke_school_notice_sync(boolean) from public;

revoke all on function public.school_notice_credentials() from public, anon, authenticated;
grant execute on function public.school_notice_credentials() to service_role;
revoke all on function public.record_school_notice_sync(jsonb, text) from public, anon, authenticated;
grant execute on function public.record_school_notice_sync(jsonb, text) to service_role;

revoke all on function public.list_school_notices() from public, anon;
grant execute on function public.list_school_notices() to authenticated;
revoke all on function public.get_school_notice(integer) from public, anon;
grant execute on function public.get_school_notice(integer) to authenticated;
revoke all on function public.admin_set_school_notice_account(text, text) from public, anon;
grant execute on function public.admin_set_school_notice_account(text, text) to authenticated;
revoke all on function public.admin_sync_school_notices() from public, anon;
grant execute on function public.admin_sync_school_notices() to authenticated;
revoke all on function public.admin_school_notice_status() from public, anon;
grant execute on function public.admin_school_notice_status() to authenticated;
