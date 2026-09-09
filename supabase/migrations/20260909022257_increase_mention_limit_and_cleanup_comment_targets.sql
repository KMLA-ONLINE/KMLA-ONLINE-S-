-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER TABLE public.comment_mentions
  DROP CONSTRAINT comment_mentions_ordinal_range;

ALTER TABLE public.post_mentions
  DROP CONSTRAINT post_mentions_ordinal_range;

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
  if (select max(entry.ordinal) from unnest(ordinals) as entry(ordinal)) > 50 then
    raise exception 'a comment can mention at most 50 members' using errcode = '22023';
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
  if (select max(entry.ordinal) from unnest(ordinals) as entry(ordinal)) > 50 then
    raise exception 'a post can mention at most 50 members' using errcode = '22023';
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

CREATE OR REPLACE FUNCTION public.delete_post_comment (
  p_comment_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  comment_record public.post_comments;
  target_post_id uuid;
  comment_group_id uuid;
  comment_post_title text;
  caller_role public.group_member_role;
  author_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select comment.post_id into target_post_id
  from public.post_comments as comment
  where comment.id = p_comment_id;
  if target_post_id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.posts as post
  where post.id = target_post_id
  for update;

  select comment.* into comment_record
  from public.post_comments as comment
  where comment.id = p_comment_id
    and comment.post_id = target_post_id
    and comment.deleted_at is null
  for update;
  if comment_record.id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  select post.group_id, post.title into comment_group_id, comment_post_title
  from public.posts as post
  where post.id = comment_record.post_id;

  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = comment_group_id
    and membership.profile_id = caller_profile_id;

  if not exists (
    select 1 from private.comment_authors as author
    where author.comment_id = p_comment_id and author.profile_id = caller_profile_id
  ) and coalesce(caller_role, 'member') not in ('owner', 'admin') then
    raise exception 'only the author or a group moderator can delete a comment'
      using errcode = '42501';
  end if;
  if exists (
    select 1
    from private.feed_bump_events as bump
    where bump.comment_id = p_comment_id
  ) then
    raise exception 'effective #업 comments cannot be deleted' using errcode = '22023';
  end if;

  select author.profile_id into author_profile_id
  from private.comment_authors as author where author.comment_id = p_comment_id;

  -- 하드 삭제는 외래 키가 이 데이터를 정리하지만, 살아 있는 자식 때문에 답글이 tombstone으로
  -- 남는 경우에도 삭제된 댓글을 가리키는 데이터는 즉시 사라져야 한다.
  delete from public.notifications where comment_id = p_comment_id;
  delete from public.comment_mentions where comment_id = p_comment_id;

  if comment_record.depth = 0 then
    -- 최상위 댓글을 지우면 답글 묶음 전체가 사라진다(기능 명세 §9.4). 묶음이 통째로 숨는 이상
    -- 자리 표시가 필요 없으므로 하드 삭제한다.
    perform 1
    from public.post_comments as comment
    where comment.root_comment_id = p_comment_id
    order by comment.id
    for update;

    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select image.storage_bucket, image.object_path, 'comment_image'
    from public.comment_images as image
    join public.post_comments as comment on comment.id = image.comment_id
    where comment.root_comment_id = p_comment_id
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run;

    delete from public.post_comments as comment
    where comment.root_comment_id = p_comment_id;
  else
    -- 답글은 아래에 살아 있는 답글이 남아 있으면 대화 연결을 위해 자리 표시로 남아야 한다
    -- (기능 명세 §9.4). 자리 표시에 필요한 것은 트리 골격뿐이므로 본문은 그 자리에서 비운다
    -- (삭제 및 보존 정책 §7.2).
    update public.post_comments as comment
    set deleted_at = now(), body = ''
    where comment.id = p_comment_id;
  end if;

  -- 자식이 없는 자리 표시는 존재 이유가 없다. 잎에서부터 걷어내면 삭제만 남은 사슬이 조상까지
  -- 함께 사라진다. 이미지 경로는 행이 사라지기 전에 큐로 옮긴다.
  loop
    with doomed as (
      select comment.id
      from public.post_comments as comment
      where comment.post_id = target_post_id
        and comment.deleted_at is not null
        and not exists (
          select 1
          from public.post_comments as child
          where child.parent_comment_id = comment.id
        )
    ), queued as (
      insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
      select image.storage_bucket, image.object_path, 'comment_image'
      from public.comment_images as image
      join doomed on doomed.id = image.comment_id
      on conflict (bucket, object_path) do update
        set dry_run = queue.dry_run and excluded.dry_run
      returning 1
    )
    delete from public.post_comments as comment
    using doomed
    where comment.id = doomed.id;
    exit when not found;
  end loop;

  perform private.invoke_storage_cleanup(p_quiet => true);
  if caller_profile_id <> author_profile_id then
    -- 댓글 원문은 싣지 않는다(기능 명세 §14.8). 대신 댓글이 달려 있던 게시물의 제목으로
    -- 어느 댓글이었는지 짚어준다. 제목은 원문이 아니고 작성자가 이미 읽을 수 있던 값이다.
    -- 프로필 타임라인 글은 제목이 없어서 예전 문장으로 떨어진다.
    perform private.emit_notification(
      'comment-moderated:' || p_comment_id::text,
      author_profile_id, 'comment_moderated', 'high', 'moderation', 'staff',
      caller_profile_id, '운영진', null,
      case when comment_post_title is null
        then '댓글이 운영자에 의해 삭제되었습니다.'
        else '“' || comment_post_title
          || '” 게시물에 남긴 내 댓글이 운영자에 의해 삭제되었습니다.'
      end,
      comment_group_id, target_post_id
    );
  end if;
end;
$function$;

ALTER TABLE public.comment_mentions
  ADD CONSTRAINT comment_mentions_ordinal_range CHECK (ordinal >= 1 AND ordinal <= 50);

ALTER TABLE public.post_mentions
  ADD CONSTRAINT post_mentions_ordinal_range CHECK (ordinal >= 1 AND ordinal <= 50);