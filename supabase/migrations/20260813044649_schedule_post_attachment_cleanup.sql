create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- PostgREST exposes only public, so the worker gets service-role-only wrappers
-- instead of exposing the private schema itself.
create function public.claim_post_attachment_cleanup(
  p_limit integer default 100,
  p_lease_seconds integer default 300
)
returns table (
  attachment_id uuid,
  storage_bucket text,
  object_path text,
  lease_id uuid
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.claim_post_attachment_cleanup(p_limit, p_lease_seconds);
$$;

create function public.complete_post_attachment_cleanup(
  p_attachment_id uuid,
  p_lease_id uuid,
  p_object_deleted boolean
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.complete_post_attachment_cleanup(
    p_attachment_id,
    p_lease_id,
    p_object_deleted
  );
$$;

revoke all on function public.claim_post_attachment_cleanup(integer, integer)
from public, anon, authenticated;
revoke all on function public.complete_post_attachment_cleanup(uuid, uuid, boolean)
from public, anon, authenticated;
grant execute on function public.claim_post_attachment_cleanup(integer, integer)
to service_role;
grant execute on function public.complete_post_attachment_cleanup(uuid, uuid, boolean)
to service_role;

-- Production setup stores these two values in Vault:
--   project_url: https://<project-ref>.supabase.co
--   post_attachment_cleanup_secret: a random secret also configured on the function
-- The local seed creates local equivalents. Missing secrets intentionally make the
-- cron request a no-op instead of placing credentials in migration history.
create function private.invoke_post_attachment_cleanup()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  cleanup_secret text;
  request_id bigint;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'project_url';

  select decrypted_secret into cleanup_secret
  from vault.decrypted_secrets
  where name = 'post_attachment_cleanup_secret';

  if project_url is null or cleanup_secret is null then
    return null;
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/cleanup-post-attachments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', cleanup_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function private.invoke_post_attachment_cleanup() from public;

select cron.schedule(
  'cleanup-post-attachments-daily',
  '17 3 * * *',
  'select private.invoke_post_attachment_cleanup()'
);
