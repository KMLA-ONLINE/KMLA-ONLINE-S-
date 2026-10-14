SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.search_directory (
  p_query text DEFAULT ''::text
)
  RETURNS TABLE (
    result_kind text,
    result_id   text,
    result_name text,
    avatar_path text,
    sort_rank   smallint
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile public.profiles;
  normalized_query text := lower(
    regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g')
  );
begin
  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if caller_profile.id is null then
    raise exception 'search requires an accepted profile' using errcode = '42501';
  end if;

  if char_length(normalized_query) < 2 then
    return;
  end if;

  return query
  (
    select
      'profile'::text,
      person.pub_id,
      person.name,
      person.avatar_path,
      case
        when person.search_name = normalized_query then 0
        when person.search_name like normalized_query || '%' then 1
        else 2
      end::smallint
    from public.profiles as person
    where person.status = 'accepted'
      and person.deleted_at is null
      and person.search_name like '%' || normalized_query || '%'
    order by 5, person.name
    limit 5
  )
  union all
  (
    select
      'group'::text,
      group_record.slug,
      group_record.name,
      group_record.icon_path,
      case
        when group_record.search_name = normalized_query then 0
        when group_record.search_name like normalized_query || '%' then 1
        else 2
      end::smallint
    from public.groups as group_record
    where caller_profile.type <> 'teacher'
      and (
        group_record.kind = 'official'
        or group_record.join_policy = 'open'
        or exists (
          select 1
          from public.group_memberships as membership
          where membership.group_id = group_record.id
            and membership.profile_id = caller_profile.id
        )
      )
      and group_record.search_name like '%' || normalized_query || '%'
    order by 5, group_record.name
    limit 5
  );
end;
$function$;
