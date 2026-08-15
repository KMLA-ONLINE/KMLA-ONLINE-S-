-- 댓글 읽기 응답에서 `parent_is_deleted`를 걷어낸다.
--
-- 부모가 삭제돼도 `@작성자` 칩을 그대로 남기기로 정하면서(기능 명세 §9.2) 이 플래그를 볼 곳이
-- 사라졌다. 화면은 `parent_comment_id`와 `parent_author_label`만 보고 칩을 그린다. 아무도 읽지
-- 않는 컬럼을 응답에 실어 두면 "언젠가 쓰겠지" 하는 자리가 되고, 그 자리를 근거로 삼은 테스트는
-- 무엇을 지키는지 모르는 채 통과한다.
--
-- 반환 모양이 바뀌므로 `create or replace`가 통하지 않는다. 다섯 함수를 모두 다시 만들고
-- grant를 재발급한다 — 빠뜨리면 런타임에서 42501로 터진다.

drop function public.list_post_comments(uuid, timestamptz, uuid, integer);
drop function public.list_post_comment_replies(uuid);
drop function public.create_post_comment(uuid, text, public.post_identity, uuid);
drop function public.update_post_comment(uuid, text);
drop function private.read_post_comments(uuid[], bigint, public.group_member_role);

create function private.read_post_comments(
  p_comment_ids uuid[],
  p_caller_profile_id bigint,
  p_caller_role public.group_member_role
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
language sql
stable
security definer
set search_path = ''
as $$
  select
    comment.id,
    comment.post_id,
    comment.parent_comment_id,
    comment.root_comment_id,
    comment.depth,
    -- tombstone은 원문도 작성자도 내보내지 않는다.
    case when comment.deleted_at is null then comment.body else '' end,
    comment.author_identity,
    case
      when comment.deleted_at is null and comment.author_identity in ('identified', 'staff')
      then profile.pub_id
    end,
    case
      when comment.deleted_at is null and comment.author_identity in ('identified', 'staff')
      then profile.name
    end,
    case
      when comment.deleted_at is null and comment.author_identity in ('identified', 'staff')
      then profile.avatar_path
    end,
    case
      when comment.deleted_at is null
      then private.comment_author_label(
        comment.author_identity, comment.anon_alias_number, profile.name
      )
    end,
    comment.created_at,
    comment.edited_at,
    comment.deleted_at is not null,
    comment.deleted_at is null and author.profile_id = p_caller_profile_id,
    comment.deleted_at is null and author.profile_id = p_caller_profile_id,
    comment.deleted_at is null
      and (
        author.profile_id = p_caller_profile_id
        or p_caller_role in ('owner', 'admin')
      ),
    case
      when comment.depth = 0 then (
        select count(*)::integer
        from public.post_comments as reply
        where reply.root_comment_id = comment.id
          and reply.depth > 0
          and reply.deleted_at is null
      )
      else 0
    end,
    -- 삭제된 댓글에는 반응을 붙일 수 없으므로 tombstone의 요약은 비운다. 지우기 전에 달려 있던
    -- 반응 행은 남아 있지만, 자국만 남은 자리에 남의 반응 수를 보여줄 이유가 없다.
    case when comment.deleted_at is null then summary.total else 0 end,
    case
      when comment.deleted_at is null then summary.top
      else array[]::public.post_reaction[]
    end,
    case when comment.deleted_at is null then mine.reaction end,
    -- 자기 본문과 달리 부모의 이름은 부모가 지워져도 내려보낸다(기능 명세 §9.2).
    case
      when parent.id is not null
      then private.comment_author_label(
        parent.author_identity, parent.anon_alias_number, parent_profile.name
      )
    end
  from public.post_comments as comment
  join private.comment_authors as author on author.comment_id = comment.id
  left join public.profiles as profile
    on (
      (comment.author_identity = 'identified' and profile.id = comment.display_author_profile_id)
      or (comment.author_identity = 'staff' and profile.id = author.profile_id)
    )
    and profile.status = 'accepted'
    and profile.deleted_at is null
  left join public.comment_reactions as mine
    on mine.comment_id = comment.id and mine.profile_id = p_caller_profile_id
  left join lateral (
    select
      coalesce(sum(tally.n)::integer, 0) as total,
      coalesce(
        array_agg(tally.reaction order by tally.n desc, tally.reaction)
          filter (where tally.rank <= 3),
        array[]::public.post_reaction[]
      ) as top
    from (
      select
        entry.reaction,
        count(*)::integer as n,
        row_number() over (order by count(*) desc, entry.reaction) as rank
      from public.comment_reactions as entry
      where entry.comment_id = comment.id
      group by entry.reaction
    ) as tally
  ) as summary on true
  left join public.post_comments as parent on parent.id = comment.parent_comment_id
  left join private.comment_authors as parent_author on parent_author.comment_id = parent.id
  left join public.profiles as parent_profile
    on (
      (parent.author_identity = 'identified' and parent_profile.id = parent.display_author_profile_id)
      or (parent.author_identity = 'staff' and parent_profile.id = parent_author.profile_id)
    )
    and parent_profile.status = 'accepted'
    and parent_profile.deleted_at is null
  where comment.id = any (p_comment_ids)
  order by comment.created_at, comment.id;
$$;

revoke all on function private.read_post_comments(uuid[], bigint, public.group_member_role)
  from public, anon, authenticated;

create function public.list_post_comments(
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
  post_group_id uuid;
  caller_role public.group_member_role;
  page_ids uuid[];
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_comment_id is null) then
    raise exception 'comment cursor must be complete' using errcode = '22023';
  end if;

  select post.group_id into post_group_id
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
    and post.published_at is not null and post.deleted_at is null;
  if post_group_id is null then
    return;
  end if;

  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = post_group_id
    and membership.profile_id = caller_profile_id;
  if caller_role is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  -- 최신부터 한 페이지를 고르고, 화면에는 오래된 순으로 그린다. 최상위 댓글을 지우면 자손까지
  -- 함께 삭제되므로 여기서는 살아 있는 행만 보면 된다.
  select array_agg(page.id) into page_ids
  from (
    select comment.id
    from public.post_comments as comment
    where comment.post_id = p_post_id
      and comment.depth = 0
      and comment.deleted_at is null
      and (
        p_cursor_comment_id is null
        or (comment.created_at, comment.id) < (p_cursor_created_at, p_cursor_comment_id)
      )
    order by comment.created_at desc, comment.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) as page;

  return query
  select entry.*
  from private.read_post_comments(
    coalesce(page_ids, '{}'::uuid[]), caller_profile_id, caller_role
  ) as entry;
end;
$$;

revoke all on function public.list_post_comments(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_post_comments(uuid, timestamptz, uuid, integer) to authenticated;

create function public.list_post_comment_replies(p_root_comment_id uuid)
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
  root_post_id uuid;
  post_group_id uuid;
  caller_role public.group_member_role;
  visible_ids uuid[];
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select comment.post_id into root_post_id
  from public.post_comments as comment
  where comment.id = p_root_comment_id
    and comment.depth = 0
    and comment.deleted_at is null;
  if root_post_id is null then
    return;
  end if;

  select post.group_id into post_group_id
  from public.posts as post
  where post.id = root_post_id and post.kind = 'group'
    and post.published_at is not null and post.deleted_at is null;
  if post_group_id is null then
    return;
  end if;

  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = post_group_id
    and membership.profile_id = caller_profile_id;
  if caller_role is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  -- 삭제된 답글은 살아 있는 자손이 있을 때만 `삭제된 댓글입니다`로 남긴다(기능 명세 §9.4).
  -- 살아 있는 노드에서 부모를 따라 올라가며 표시해야 할 조상을 모은다.
  with recursive subtree as (
    select comment.id, comment.parent_comment_id, comment.deleted_at, comment.depth
    from public.post_comments as comment
    where comment.root_comment_id = p_root_comment_id
  ),
  live_ancestor as (
    select node.parent_comment_id as id
    from subtree as node
    where node.deleted_at is null and node.parent_comment_id is not null
    union
    select node.parent_comment_id
    from live_ancestor as walked
    join subtree as node on node.id = walked.id
    where node.parent_comment_id is not null
  )
  select array_agg(node.id) into visible_ids
  from subtree as node
  where node.depth > 0
    and (
      node.deleted_at is null
      or node.id in (select ancestor.id from live_ancestor as ancestor)
    );

  return query
  select entry.*
  from private.read_post_comments(
    coalesce(visible_ids, '{}'::uuid[]), caller_profile_id, caller_role
  ) as entry;
end;
$$;

revoke all on function public.list_post_comment_replies(uuid) from public, anon;
grant execute on function public.list_post_comment_replies(uuid) to authenticated;

create function public.create_post_comment(
  p_post_id uuid,
  p_body text,
  p_author_identity public.post_identity,
  p_parent_comment_id uuid default null
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
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  group_record public.groups;
  caller_role public.group_member_role;
  parent_record public.post_comments;
  post_author_profile_id bigint;
  new_comment_id uuid := gen_random_uuid();
  new_depth smallint := 0;
  new_root_id uuid;
  new_alias smallint;
  trimmed_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
    and post.published_at is not null and post.deleted_at is null;
  if post_record.id is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;

  select group_data.* into group_record
  from public.groups as group_data
  where group_data.id = post_record.group_id;

  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = post_record.group_id
    and membership.profile_id = caller_profile_id;
  if caller_role is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  -- `posting_policy`는 확인하지 않는다. 운영진 작성 그룹에서도 모든 멤버가 댓글을 남길 수
  -- 있다(기능 명세 §8.2).
  if p_author_identity = 'identified'
    and group_record.identity_policy = 'always_anonymous' then
    raise exception 'identified commenting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous'
    and group_record.identity_policy = 'identified' then
    raise exception 'anonymous commenting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'staff'
    and caller_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;

  if trimmed_body = '' or char_length(trimmed_body) > 5000 then
    raise exception 'comment must contain between 1 and 5000 characters' using errcode = '22023';
  end if;

  if p_parent_comment_id is not null then
    select parent.* into parent_record
    from public.post_comments as parent
    where parent.id = p_parent_comment_id and parent.deleted_at is null;
    if parent_record.id is null then
      raise exception 'parent comment not found' using errcode = 'P0002';
    end if;
    if parent_record.post_id <> p_post_id then
      raise exception 'parent comment must belong to the post' using errcode = '22023';
    end if;
    if parent_record.depth >= 10 then
      raise exception 'replies cannot nest deeper than 10 levels' using errcode = '22023';
    end if;
    new_depth := (parent_record.depth + 1)::smallint;
    new_root_id := parent_record.root_comment_id;
  else
    new_root_id := new_comment_id;
  end if;

  if p_author_identity = 'anonymous' then
    select author.profile_id into post_author_profile_id
    from private.post_authors as author
    where author.post_id = p_post_id;

    -- `글쓴이`는 게시물 자체가 익명일 때만 붙인다. 실명 게시물의 작성자에게 붙이면 실명과
    -- 익명 댓글이 연결돼 익명 선택이 무너진다(기능 명세 §9.3).
    if post_record.author_identity = 'anonymous'
      and post_author_profile_id = caller_profile_id then
      new_alias := 0;
    else
      select alias.alias_number into new_alias
      from private.post_anonymous_aliases as alias
      where alias.post_id = p_post_id and alias.profile_id = caller_profile_id;

      if new_alias is null then
        -- 같은 게시물에 첫 익명 댓글이 동시에 들어와도 번호가 겹치지 않게 게시물 단위로 잠근다.
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(p_post_id::text, 0)
        );
        select alias.alias_number into new_alias
        from private.post_anonymous_aliases as alias
        where alias.post_id = p_post_id and alias.profile_id = caller_profile_id;

        if new_alias is null then
          select coalesce(max(alias.alias_number), 0) + 1 into new_alias
          from private.post_anonymous_aliases as alias
          where alias.post_id = p_post_id;
          insert into private.post_anonymous_aliases (post_id, profile_id, alias_number)
          values (p_post_id, caller_profile_id, new_alias);
        end if;
      end if;
    end if;
  end if;

  insert into public.post_comments (
    id, post_id, parent_comment_id, root_comment_id, depth, body,
    author_identity, display_author_profile_id, anon_alias_number
  ) values (
    new_comment_id, p_post_id, p_parent_comment_id, new_root_id, new_depth, trimmed_body,
    p_author_identity,
    case when p_author_identity = 'identified' then caller_profile_id end,
    new_alias
  );

  insert into private.comment_authors (comment_id, profile_id)
  values (new_comment_id, caller_profile_id);

  return query
  select entry.*
  from private.read_post_comments(
    array[new_comment_id], caller_profile_id, caller_role
  ) as entry;
end;
$$;

revoke all on function public.create_post_comment(uuid, text, public.post_identity, uuid)
  from public, anon;
grant execute on function public.create_post_comment(uuid, text, public.post_identity, uuid)
  to authenticated;

create function public.update_post_comment(p_comment_id uuid, p_body text)
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
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  comment_record public.post_comments;
  comment_group_id uuid;
  caller_role public.group_member_role;
  trimmed_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select comment.* into comment_record
  from public.post_comments as comment
  where comment.id = p_comment_id and comment.deleted_at is null;
  if comment_record.id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from private.comment_authors as author
    where author.comment_id = p_comment_id and author.profile_id = caller_profile_id
  ) then
    raise exception 'only the author can edit a comment' using errcode = '42501';
  end if;

  if trimmed_body = '' or char_length(trimmed_body) > 5000 then
    raise exception 'comment must contain between 1 and 5000 characters' using errcode = '22023';
  end if;

  select post.group_id into comment_group_id
  from public.posts as post
  where post.id = comment_record.post_id;

  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = comment_group_id
    and membership.profile_id = caller_profile_id;

  update public.post_comments as comment
  set body = trimmed_body, edited_at = now()
  where comment.id = p_comment_id;

  return query
  select entry.*
  from private.read_post_comments(
    array[p_comment_id], caller_profile_id, caller_role
  ) as entry;
end;
$$;

revoke all on function public.update_post_comment(uuid, text) from public, anon;
grant execute on function public.update_post_comment(uuid, text) to authenticated;
