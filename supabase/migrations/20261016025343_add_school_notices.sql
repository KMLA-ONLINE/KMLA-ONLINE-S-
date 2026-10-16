SET local check_function_bodies = off;

CREATE TABLE "private"."school_notice_sync_state" (
  "id"                 boolean                  NOT NULL DEFAULT true,
  "account_updated_at" timestamp with time zone,
  "last_requested_at"  timestamp with time zone,
  "last_attempt_at"    timestamp with time zone,
  "last_success_at"    timestamp with time zone,
  "last_error"         text,
  "last_error_at"      timestamp with time zone,
  CONSTRAINT "school_notice_sync_state_pkey" PRIMARY KEY (id),
  CONSTRAINT "school_notice_sync_state_singleton" CHECK (id)
);

CREATE TABLE "private"."school_notices" (
  "post_id"        integer  NOT NULL,
  "list_position"  smallint NOT NULL,
  "category"       text     NOT NULL,
  "title"          text     NOT NULL,
  "author"         text     NOT NULL,
  "posted_on"      date     NOT NULL,
  "has_attachment" boolean  NOT NULL DEFAULT false,
  CONSTRAINT "school_notices_list_position_check" CHECK ((list_position >= 0)),
  CONSTRAINT "school_notices_pkey" PRIMARY KEY (post_id)
);

CREATE OR REPLACE FUNCTION private.invoke_school_notice_sync (
  p_quiet boolean DEFAULT false
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.put_vault_secret (
  p_name  text,
  p_value text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_school_notice_status()
  RETURNS TABLE (
    login_id           text,
    account_configured boolean,
    sync_configured    boolean,
    account_updated_at timestamp with time zone,
    last_requested_at  timestamp with time zone,
    last_attempt_at    timestamp with time zone,
    last_success_at    timestamp with time zone,
    last_error         text,
    last_error_at      timestamp with time zone,
    notice_count       integer
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."admin_school_notice_status"() FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.admin_set_school_notice_account (
  p_login_id text,
  p_password text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."admin_set_school_notice_account"(text, text) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.admin_sync_school_notices()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_app_admin();
  perform private.invoke_school_notice_sync();
end;
$function$;

REVOKE ALL ON FUNCTION "public"."admin_sync_school_notices"() FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.list_school_notices()
  RETURNS TABLE (
    post_id        integer,
    category       text,
    title          text,
    author         text,
    posted_on      date,
    has_attachment boolean,
    synced_at      timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."list_school_notices"() FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.record_school_notice_sync (
  p_notices jsonb,
  p_error   text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
    post_id, list_position, category, title, author, posted_on, has_attachment
  )
  select
    (item.value ->> 'postId')::integer,
    (item.ordinality - 1)::smallint,
    item.value ->> 'category',
    item.value ->> 'title',
    item.value ->> 'author',
    (item.value ->> 'postedOn')::date,
    coalesce((item.value ->> 'hasAttachment')::boolean, false)
  from jsonb_array_elements(p_notices) with ordinality as item(value, ordinality);

  insert into private.school_notice_sync_state (id, last_attempt_at, last_success_at)
  values (true, now(), now())
  on conflict (id) do update
  set last_attempt_at = excluded.last_attempt_at,
    last_success_at = excluded.last_success_at;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."record_school_notice_sync"(jsonb, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.school_notice_credentials()
  RETURNS TABLE (
    login_id text,
    password text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select login.decrypted_secret, password.decrypted_secret
  from vault.decrypted_secrets as login
  cross join vault.decrypted_secrets as password
  where login.name = 'school_notice_login_id'
    and password.name = 'school_notice_password';
$function$;

REVOKE ALL ON FUNCTION "public"."school_notice_credentials"() FROM PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "private"."invoke_school_notice_sync"(boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."put_vault_secret"(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."admin_school_notice_status"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_school_notice_status"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_school_notice_status"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_set_school_notice_account"(text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_set_school_notice_account"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_set_school_notice_account"(text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_sync_school_notices"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_sync_school_notices"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_sync_school_notices"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_school_notices"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_school_notices"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_school_notices"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."record_school_notice_sync"(jsonb, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_school_notice_sync"(jsonb, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_school_notice_sync"(jsonb, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."school_notice_credentials"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."school_notice_credentials"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."school_notice_credentials"() TO "service_role";

SELECT cron.schedule_in_database('sync-school-notices', '7,37 * * * *', 'select private.invoke_school_notice_sync()', 'postgres', NULL, true);
