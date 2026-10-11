SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.search_group_mention_candidates (
  p_group_id uuid,
  p_query    text    DEFAULT ''::text,
  p_limit    integer DEFAULT 30
)
  RETURNS TABLE (
    pub_id               text,
    name                 text,
    cohort               smallint,
    is_returning_student boolean,
    profile_type         public.profile_type,
    avatar_path          text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  query_text text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 50 then
    raise exception 'mention candidate limit must be between 1 and 50' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
  ) then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select profile.pub_id, profile.name, profile.cohort,
    profile.is_returning_student, profile.type, profile.avatar_path
  from public.group_memberships as membership
  join public.profiles as profile on profile.id = membership.profile_id
  where membership.group_id = p_group_id
    -- 자기 자신은 부를 일이 없어 후보에서 뺀다. 본문에 이미 있는 자기 멘션은 그대로 저장된다.
    and profile.id <> caller_profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and (
      query_text = ''
      or profile.name ilike '%' || query_text || '%'
      -- 명부와 같은 규칙으로 표시값을 검색한다. 복학생은 n.5기로 보이므로 '20'이 20기와
      -- 20.5기를 함께 찾는다.
      or (
        profile.cohort + case when profile.is_returning_student then 0.5 else 0 end
      )::text like '%' || query_text || '%'
      -- 선생님은 기수가 없어 화면에 '선생님'으로 나온다. 보이는 대로 검색되어야 한다.
      or (profile.type = 'teacher' and '선생님' like '%' || query_text || '%')
    )
  order by
    case when profile.type = 'teacher' then 0 else 1 end,
    (profile.cohort + case when profile.is_returning_student then 0.5 else 0 end)
      desc nulls last,
    profile.name,
    profile.id
  limit p_limit;
end;
$function$;
