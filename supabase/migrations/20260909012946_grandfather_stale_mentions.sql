-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION private.parse_mention_ordinals (
  p_body text
)
  RETURNS smallint[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select coalesce(
    array_agg(distinct (found.match[1])::smallint order by (found.match[1])::smallint),
    array[]::smallint[]
  )
  from regexp_matches(
    coalesce(p_body, ''), '\[@[^\]\n]*\]\(m:([0-9]{1,2})\)', 'g'
  ) as found(match);
$function$;

CREATE OR REPLACE FUNCTION private.sync_comment_mentions (
  p_comment_id      uuid,
  p_body            text,
  p_author_identity public.post_identity,
  p_mention_pub_ids text[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  post_record public.posts;
  ordinals smallint[] := private.parse_mention_ordinals(p_body);
  already_mentioned bigint[];
  resolved_count integer;
begin
  select coalesce(array_agg(mention.profile_id), '{}'::bigint[])
  into already_mentioned
  from public.comment_mentions as mention
  where mention.comment_id = p_comment_id;

  delete from public.comment_mentions where comment_id = p_comment_id;
  if coalesce(array_length(ordinals, 1), 0) = 0 then
    return;
  end if;

  select post.* into post_record
  from public.posts as post
  join public.post_comments as comment on comment.post_id = post.id
  where comment.id = p_comment_id;
  -- 개인 게시물의 댓글에는 멘션을 두지 않는다(기능 명세 §8.14).
  if post_record.kind <> 'group' then
    raise exception 'mentions are only available in group posts' using errcode = '22023';
  end if;
  if p_author_identity = 'anonymous' then
    raise exception 'anonymous comments cannot mention members' using errcode = '42501';
  end if;
  if (select max(entry.ordinal) from unnest(ordinals) as entry(ordinal)) > 10 then
    raise exception 'a comment can mention at most 10 members' using errcode = '22023';
  end if;

  -- 이미 불린 사람은 멤버십을 다시 묻지 않는다. 다시 물으면 멘션된 멤버가 그룹을 나간 뒤로는
  -- 제목 오타 하나 고치려 해도 저장이 막히고, 작성자가 본문에서 그 토큰을 손으로 찾아 지우는
  -- 수밖에 없다. 이미 나간 시점의 알림은 이미 갔고 칩은 프로필로 남는다 -- 새로 부르는
  -- 사람에게만 멤버십을 요구하면 충분하다.
  insert into public.comment_mentions (comment_id, ordinal, profile_id)
  select p_comment_id, entry.ordinal, profile.id
  from unnest(ordinals) as entry(ordinal)
  join public.profiles as profile
    on lower(profile.pub_id) = lower(btrim(coalesce(p_mention_pub_ids[entry.ordinal], '')))
    and profile.status = 'accepted'
    and profile.deleted_at is null
  where profile.id = any(already_mentioned)
    or exists (
      select 1
      from public.group_memberships as membership
      where membership.group_id = post_record.group_id
        and membership.profile_id = profile.id
    );
  get diagnostics resolved_count = row_count;

  if resolved_count <> array_length(ordinals, 1) then
    raise exception 'every mention must name a current group member' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.sync_post_mentions (
  p_post_id         uuid,
  p_body            text,
  p_mention_pub_ids text[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  post_record public.posts;
  ordinals smallint[] := private.parse_mention_ordinals(p_body);
  already_mentioned bigint[];
  resolved_count integer;
begin
  select coalesce(array_agg(mention.profile_id), '{}'::bigint[])
  into already_mentioned
  from public.post_mentions as mention
  where mention.post_id = p_post_id;

  delete from public.post_mentions where post_id = p_post_id;
  if coalesce(array_length(ordinals, 1), 0) = 0 then
    return;
  end if;

  select post.* into post_record from public.posts as post where post.id = p_post_id;
  if post_record.kind <> 'group' then
    raise exception 'mentions are only available in group posts' using errcode = '22023';
  end if;
  -- 익명 뒤에서 특정인을 지목하지 못하게 막는다. 운영진 명의는 실제 작성자의 이름과 사진을
  -- 그대로 보여주므로(기능 명세 §8.6) 익명이 아니고, 여기서 막지 않는다.
  if post_record.author_identity = 'anonymous' then
    raise exception 'anonymous posts cannot mention members' using errcode = '42501';
  end if;
  if (select max(entry.ordinal) from unnest(ordinals) as entry(ordinal)) > 10 then
    raise exception 'a post can mention at most 10 members' using errcode = '22023';
  end if;

  -- 이미 불린 사람은 멤버십을 다시 묻지 않는다. 다시 물으면 멘션된 멤버가 그룹을 나간 뒤로는
  -- 제목 오타 하나 고치려 해도 저장이 막히고, 작성자가 본문에서 그 토큰을 손으로 찾아 지우는
  -- 수밖에 없다. 이미 나간 시점의 알림은 이미 갔고 칩은 프로필로 남는다 -- 새로 부르는
  -- 사람에게만 멤버십을 요구하면 충분하다.
  insert into public.post_mentions (post_id, ordinal, profile_id)
  select p_post_id, entry.ordinal, profile.id
  from unnest(ordinals) as entry(ordinal)
  join public.profiles as profile
    on lower(profile.pub_id) = lower(btrim(coalesce(p_mention_pub_ids[entry.ordinal], '')))
    and profile.status = 'accepted'
    and profile.deleted_at is null
  where profile.id = any(already_mentioned)
    or exists (
      select 1
      from public.group_memberships as membership
      where membership.group_id = post_record.group_id
        and membership.profile_id = profile.id
    );
  get diagnostics resolved_count = row_count;

  -- 토큰 하나가 남으면 화면에는 멘션이 보이는데 아무도 불리지 않는다. 조용히 흘리지 않고
  -- 통째로 되돌린다.
  if resolved_count <> array_length(ordinals, 1) then
    raise exception 'every mention must name a current group member' using errcode = '22023';
  end if;
end;
$function$;