create or replace function public.list_post_comments(
  p_post_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_comment_id uuid default null,
  p_limit integer default 20
)
returns table (
  comment_id uuid,
  post_id uuid,
  parent_comment_id uuid,
  root_comment_id uuid,
  depth smallint,
  body text,
  author_identity public.post_identity,
  author_pub_id text,
  author_name text,
  author_avatar_path text,
  author_label text,
  created_at timestamptz,
  edited_at timestamptz,
  is_deleted boolean,
  is_author boolean,
  can_edit boolean,
  can_delete boolean,
  reply_count integer,
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction,
  parent_author_label text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  context record;
  page_ids uuid[];
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_comment_id is null) then
    raise exception 'comment cursor must be complete' using errcode = '22023';
  end if;

  context := private.comment_post_context(p_post_id, caller_profile_id);
  if not context.is_visible then
    return;
  end if;

  -- 대화를 처음부터 읽을 수 있도록 오래된 최상위 댓글부터 고르고, 커서 뒤의 새 댓글을 잇는다.
  -- 최상위 댓글을 지우면 자손까지 함께 삭제되므로 여기서는 살아 있는 행만 보면 된다.
  select array_agg(page.id order by page.created_at, page.id) into page_ids
  from (
    select comment.id, comment.created_at
    from public.post_comments as comment
    where comment.post_id = p_post_id
      and comment.depth = 0
      and comment.deleted_at is null
      and (
        p_cursor_comment_id is null
        or (comment.created_at, comment.id) > (p_cursor_created_at, p_cursor_comment_id)
      )
    order by comment.created_at, comment.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) as page;

  return query
  select entry.*
  from private.read_post_comments(
    coalesce(page_ids, '{}'::uuid[]), caller_profile_id, context.caller_role
  ) as entry;
end;
$$;

revoke all on function public.list_post_comments(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_post_comments(uuid, timestamptz, uuid, integer) to authenticated;
