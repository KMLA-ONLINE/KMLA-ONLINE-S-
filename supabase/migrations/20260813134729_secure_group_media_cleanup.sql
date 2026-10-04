create or replace function private.can_read_group_media(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.groups as group_record
      join public.profiles as profile
        on profile.auth_user_id = auth.uid()
        and profile.status = 'accepted'
        and profile.deleted_at is null
      where p_object_path in (group_record.icon_path, group_record.cover_path)
        and (
          (
            profile.type in ('student', 'alumni')
            and (
              group_record.kind = 'official'
              or (
                group_record.kind = 'unofficial'
                and group_record.join_policy <> 'invite_only'
              )
            )
          )
          or (
            group_record.kind = 'unofficial'
            and private.is_group_member(group_record.id)
          )
        )
    );
$$;

create function public.claim_group_media_cleanup(
  p_limit integer default 100,
  p_lease_seconds integer default 300
)
returns table (media_id uuid, object_path text, lease_id uuid)
language sql
security definer
set search_path = ''
as $$
  select *
  from private.claim_group_media_cleanup(p_limit, p_lease_seconds);
$$;

create function public.complete_group_media_cleanup(
  p_media_id uuid,
  p_lease_id uuid,
  p_object_deleted boolean
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.complete_group_media_cleanup(
    p_media_id,
    p_lease_id,
    p_object_deleted
  );
$$;

revoke all on function public.claim_group_media_cleanup(integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_group_media_cleanup(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_group_media_cleanup(integer, integer)
  to service_role;
grant execute on function public.complete_group_media_cleanup(uuid, uuid, boolean)
  to service_role;
