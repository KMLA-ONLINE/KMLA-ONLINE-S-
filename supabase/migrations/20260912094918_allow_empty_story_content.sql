-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER TABLE public.stories
  DROP CONSTRAINT stories_content_length;

CREATE OR REPLACE FUNCTION public.set_my_story (
  p_content text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  normalized_content text := btrim(coalesce(p_content, ''));
  kst_date date;
  day_start timestamptz;
  day_end timestamptz;
begin
  if char_length(normalized_content) > 100 then
    raise exception 'content must be at most 100 characters'
      using errcode = '22023';
  end if;

  -- 쓰기는 재학생과 교사만 한다. 졸업생은 읽기만 하며, 그중에서도 교사 스토리만 본다
  -- (기능 명세 §17.6).
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and profile.type in ('student', 'teacher');

  if caller_profile_id is null then
    raise exception 'student or teacher profile required'
      using errcode = '42501';
  end if;

  kst_date := (now() at time zone 'Asia/Seoul')::date;
  day_start := kst_date::timestamp at time zone 'Asia/Seoul';
  day_end := (kst_date + 1)::timestamp at time zone 'Asia/Seoul';

  delete from public.stories
  where profile_id = caller_profile_id
    and created_at >= day_start
    and created_at < day_end;

  insert into public.stories (profile_id, content)
  values (caller_profile_id, normalized_content);
end;
$function$;

REVOKE ALL ON FUNCTION public.set_my_story(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_my_story(text) TO authenticated;

ALTER TABLE public.stories
  ADD CONSTRAINT stories_content_length CHECK (char_length(btrim(content)) <= 100);
