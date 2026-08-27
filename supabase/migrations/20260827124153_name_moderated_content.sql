-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.delete_group_post (
  p_post_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  caller_role public.group_member_role;
  author_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record from public.posts as post
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null
  for update;
  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = post_record.group_id
    and membership.profile_id = caller_profile_id;
  if post_record.id is null or caller_role is null then
    raise exception 'post not found or not accessible' using errcode = '42501';
  end if;
  if caller_role not in ('owner', 'admin') and not private.is_post_author(p_post_id) then
    raise exception 'post deletion is not allowed' using errcode = '42501';
  end if;
  select author.profile_id into author_profile_id
  from private.post_authors as author where author.post_id = p_post_id;
  update public.posts set deleted_at = now(), pinned_at = null where id = p_post_id;
  update public.post_attachments
  set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
    cleanup_lease_expires_at = null
  where post_id = p_post_id and status <> 'deleted';
  if caller_profile_id <> author_profile_id then
    -- 어느 글이 사라졌는지 제목으로 말해준다. 삭제된 게시물은 열어볼 수 없으므로 알림이
    -- 대상을 밝히지 않으면 작성자는 무엇이 지워졌는지 영영 알 수 없다. 제목은 작성자
    -- 본인이 쓴 값이고 새 그룹 게시물 알림이 이미 같은 값을 그대로 싣는다. 본문은 싣지
    -- 않는다 -- 알림 제목은 잠금 화면 Push 본문이 되므로 원문이 나가서는 안 된다.
    perform private.emit_notification(
      'post-moderated:' || p_post_id::text,
      author_profile_id, 'post_moderated', 'high', 'moderation', 'staff',
      caller_profile_id, '운영진', null,
      '“' || post_record.title || '” 게시물이 운영자에 의해 삭제되었습니다.',
      post_record.group_id
    );
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

  if comment_record.depth = 0 then
    -- 최상위 댓글을 지우면 답글 묶음 전체가 사라진다(기능 명세 §9.4).
    perform 1
    from public.post_comments as comment
    where comment.root_comment_id = p_comment_id
      and comment.deleted_at is null
    order by comment.id
    for update;

    update public.post_comments as comment
    set deleted_at = now()
    where comment.root_comment_id = p_comment_id and comment.deleted_at is null;
  else
    update public.post_comments as comment
    set deleted_at = now()
    where comment.id = p_comment_id;
  end if;
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