SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.story_writer_profile_id()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  active_count integer;
begin
  -- 쓰기는 재학생과 교사만 한다. 졸업생은 읽기만 하며, 그중에서도 교사 스토리만 본다
  -- (기능 명세 §17.6). 프로필 행을 잠가 동시에 올린 스토리가 상한을 함께 넘지 못하게 한다.
  select profile.id
  into caller_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null
    and profile.type in ('student', 'teacher')
  -- `no key update`면 상한 검사끼리는 순서가 잡히면서도, 이 프로필을 참조하는 다른 행의 외래
  -- 키 검사(`key share`)는 막지 않는다.
  for no key update;

  if caller_profile_id is null then
    raise exception 'student or teacher profile required'
      using errcode = '42501';
  end if;

  select count(*)
  into active_count
  from public.stories as story
  where story.profile_id = caller_profile_id
    and (
      (story.status = 'ready' and story.expires_at > now())
      -- 미완성 업로드는 정리 작업이 지우는 48시간 동안 센다. 24시간만 세면 그 사이에 한도를
      -- 다시 채워 회수되지 않은 행을 두 배로 쌓을 수 있다.
      or (story.status = 'pending' and story.created_at > now() - interval '48 hours')
    );

  if active_count >= 20 then
    raise exception 'too many active stories'
      using errcode = '54000';
  end if;

  return caller_profile_id;
end;
$function$;
