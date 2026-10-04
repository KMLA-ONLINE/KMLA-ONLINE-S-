-- 그룹 게시물 댓글 및 답글 (기능 명세 §9).
--
-- 게시물과 같은 신원 분리를 따른다: `public.post_comments`는 표현용 값만 담고 실제 작성자는
-- `private.comment_authors`에만 둔다. 익명 번호의 원본인 `private.post_anonymous_aliases`도
-- 클라이언트에 노출하지 않는다 — 같은 사용자를 여러 게시물에 걸쳐 연결할 수 있게 되기 때문이다.
--
-- 게시물과 달리 `post_comments`에는 select grant도 주지 않는다. 삭제된 댓글은 살아 있는 자손이
-- 있을 때만 tombstone으로 보여야 하는데, 직접 select를 열면 그 판정을 건너뛰고 삭제된 본문까지
-- 읽을 수 있다. 모든 읽기는 definer RPC를 거친다.

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  parent_comment_id uuid references public.post_comments (id) on delete cascade,
  root_comment_id uuid not null,
  depth smallint not null default 0,
  body text not null,
  author_identity public.post_identity not null,
  display_author_profile_id bigint references public.profiles (id),
  anon_alias_number smallint,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint post_comments_body_length check (
    char_length(btrim(body)) between 1 and 5000
  ),
  constraint post_comments_depth_range check (depth between 0 and 10),
  constraint post_comments_display_author_shape check (
    (author_identity = 'identified' and display_author_profile_id is not null)
    or (author_identity in ('anonymous', 'staff') and display_author_profile_id is null)
  ),
  -- 익명 번호 0은 `글쓴이`, 1 이상은 `익명n`이다.
  constraint post_comments_anon_alias_shape check (
    (author_identity = 'anonymous' and anon_alias_number is not null and anon_alias_number >= 0)
    or (author_identity <> 'anonymous' and anon_alias_number is null)
  ),
  constraint post_comments_thread_shape check (
    (depth = 0 and parent_comment_id is null and root_comment_id = id)
    or (depth > 0 and parent_comment_id is not null and root_comment_id <> id)
  ),
  constraint post_comments_edit_timestamps check (
    (edited_at is null or edited_at >= created_at)
    and (deleted_at is null or deleted_at >= created_at)
  )
);

-- 최상위 목록은 최신부터 과거로 훑는다.
create index post_comments_top_level_idx
  on public.post_comments (post_id, created_at desc, id desc)
  where depth = 0 and deleted_at is null;

-- 답글 묶음은 최상위 하나를 통째로 읽는다. tombstone 판정에 삭제된 행도 필요하므로 부분
-- 인덱스로 거르지 않는다.
create index post_comments_thread_idx
  on public.post_comments (root_comment_id, created_at, id);

create index post_comments_live_child_idx
  on public.post_comments (parent_comment_id)
  where deleted_at is null;

alter table public.post_comments enable row level security;
revoke all on table public.post_comments from anon, authenticated;

create policy "post_comments_deny_client_access"
on public.post_comments
for all
to public
using (false)
with check (false);

create table private.comment_authors (
  comment_id uuid primary key references public.post_comments (id) on delete cascade,
  profile_id bigint not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index comment_authors_profile_idx
  on private.comment_authors (profile_id, comment_id);

alter table private.comment_authors enable row level security;
revoke all on table private.comment_authors from anon, authenticated;

create policy "comment_authors_deny_client_access"
on private.comment_authors
for all
to public
using (false)
with check (false);

create table private.post_anonymous_aliases (
  post_id uuid not null references public.posts (id) on delete cascade,
  profile_id bigint not null references public.profiles (id),
  alias_number smallint not null,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id),
  constraint post_anonymous_aliases_number_positive check (alias_number >= 1),
  constraint post_anonymous_aliases_number_unique unique (post_id, alias_number)
);

alter table private.post_anonymous_aliases enable row level security;
revoke all on table private.post_anonymous_aliases from anon, authenticated;

create policy "post_anonymous_aliases_deny_client_access"
on private.post_anonymous_aliases
for all
to public
using (false)
with check (false);

-- 목록 화면이 게시물마다 댓글을 세지 않도록 비정규화한다. `groups.member_count`와 같은 방식이다.
alter table public.posts
  add column comment_count integer not null default 0,
  add constraint posts_comment_count_nonnegative check (comment_count >= 0);

create function private.sync_post_comment_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null then
      update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    end if;
  elsif tg_op = 'DELETE' then
    if old.deleted_at is null then
      update public.posts
      set comment_count = greatest(comment_count - 1, 0)
      where id = old.post_id;
    end if;
  elsif old.deleted_at is null and new.deleted_at is not null then
    update public.posts
    set comment_count = greatest(comment_count - 1, 0)
    where id = new.post_id;
  elsif old.deleted_at is not null and new.deleted_at is null then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
  end if;
  return null;
end;
$$;

revoke all on function private.sync_post_comment_count() from public, anon, authenticated;

create trigger post_comments_sync_count
after insert or delete or update of deleted_at on public.post_comments
for each row execute function private.sync_post_comment_count();

-- 게시물과 같은 이유로 신원과 스레드 위치는 작성 이후 바뀌지 않는다(기능 명세 §8.5).
create function private.prevent_comment_immutable_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.post_id is distinct from old.post_id
    or new.parent_comment_id is distinct from old.parent_comment_id
    or new.root_comment_id is distinct from old.root_comment_id
    or new.depth is distinct from old.depth
    or new.author_identity is distinct from old.author_identity
    or new.display_author_profile_id is distinct from old.display_author_profile_id
    or new.anon_alias_number is distinct from old.anon_alias_number
    or new.created_at is distinct from old.created_at then
    raise exception 'comment identity and thread position cannot be changed'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_comment_immutable_changes() from public, anon, authenticated;

create trigger post_comments_prevent_immutable_changes
before update on public.post_comments
for each row execute function private.prevent_comment_immutable_changes();

-- 표시 이름 계산. 값만 받아 문자열을 돌려주는 순수 함수라 권한 경계와 무관하다.
create function private.comment_author_label(
  p_identity public.post_identity,
  p_alias smallint,
  p_name text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_identity
    when 'identified' then p_name
    when 'staff' then '운영진'
    when 'anonymous' then
      case when p_alias = 0 then '글쓴이' else '익명' || p_alias::text end
  end;
$$;

revoke all on function private.comment_author_label(public.post_identity, smallint, text)
  from public, anon, authenticated;

-- 세 읽기 경로(목록, 답글 묶음, 방금 작성한 댓글)가 같은 행 모양을 쓰도록 모으는 집합 함수.
--
-- 호출자를 인자로 받으므로 클라이언트가 직접 부르면 남의 권한을 사칭할 수 있다. 그래서
-- execute 권한을 어디에도 주지 않고, 이미 호출자를 검증한 definer RPC 안에서만 부른다.
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
  parent_author_label text,
  parent_is_deleted boolean
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
    case
      when parent.id is not null and parent.deleted_at is null
      then private.comment_author_label(
        parent.author_identity, parent.anon_alias_number, parent_profile.name
      )
    end,
    parent.id is not null and parent.deleted_at is not null
  from public.post_comments as comment
  join private.comment_authors as author on author.comment_id = comment.id
  left join public.profiles as profile
    on (
      (comment.author_identity = 'identified' and profile.id = comment.display_author_profile_id)
      or (comment.author_identity = 'staff' and profile.id = author.profile_id)
    )
    and profile.status = 'accepted'
    and profile.deleted_at is null
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
  parent_author_label text,
  parent_is_deleted boolean
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
  parent_author_label text,
  parent_is_deleted boolean
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
  parent_author_label text,
  parent_is_deleted boolean
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
  parent_author_label text,
  parent_is_deleted boolean
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

create function public.delete_post_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  comment_record public.post_comments;
  comment_group_id uuid;
  caller_role public.group_member_role;
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

  select post.group_id into comment_group_id
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

  if comment_record.depth = 0 then
    -- 최상위 댓글을 지우면 답글 묶음 전체가 사라진다(기능 명세 §9.4).
    update public.post_comments as comment
    set deleted_at = now()
    where comment.root_comment_id = p_comment_id and comment.deleted_at is null;
  else
    update public.post_comments as comment
    set deleted_at = now()
    where comment.id = p_comment_id;
  end if;
end;
$$;

revoke all on function public.delete_post_comment(uuid) from public, anon;
grant execute on function public.delete_post_comment(uuid) to authenticated;

-- 게시물 카드와 상세가 댓글 수를 보여줘야 하므로 두 읽기 RPC의 반환 모양이 바뀐다.
-- 반환 테이블에 컬럼을 더하는 것은 `create or replace`로 안 되므로 통째로 다시 만든다.
-- 검색 결과에는 댓글 수를 표시하지 않으므로(기능 명세 §8.9) `search_group_posts`는 그대로 둔다.
drop function public.list_group_posts(uuid, uuid, timestamptz, uuid, boolean, integer);

create function public.list_group_posts(
  p_group_id uuid,
  p_category_id uuid default null,
  p_cursor_published_at timestamptz default null,
  p_cursor_post_id uuid default null,
  p_cursor_is_pinned boolean default null,
  p_limit integer default 20
)
returns table (
  post_id uuid, group_id uuid, category_id uuid, category_name text,
  title text, body text, author_identity public.post_identity,
  author_pub_id text, author_name text, author_avatar_path text, author_label text,
  is_pinned boolean, published_at timestamptz, edited_at timestamptz,
  comment_count integer,
  is_author boolean, can_edit boolean, can_delete boolean, can_pin boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  caller_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if (p_cursor_published_at is null) <> (p_cursor_post_id is null)
    or (p_cursor_post_id is null) <> (p_cursor_is_pinned is null) then
    raise exception 'post cursor must be complete' using errcode = '22023';
  end if;
  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id;
  if caller_role is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select
    post.id, post.group_id, post.category_id, category.name,
    post.title, post.body, post.author_identity,
    case when post.author_identity in ('identified', 'staff') then profile.pub_id end,
    case when post.author_identity in ('identified', 'staff') then profile.name end,
    case when post.author_identity in ('identified', 'staff') then profile.avatar_path end,
    case post.author_identity
      when 'identified' then profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    post.pinned_at is not null, post.published_at, post.edited_at,
    post.comment_count,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id or caller_role in ('owner', 'admin'),
    caller_role in ('owner', 'admin', 'manager')
  from public.posts as post
  join private.post_authors as author on author.post_id = post.id
  left join public.group_categories as category on category.id = post.category_id
  left join public.profiles as profile
    on (
      (post.author_identity = 'identified' and profile.id = post.display_author_profile_id)
      or (post.author_identity = 'staff' and profile.id = author.profile_id)
    )
    and profile.status = 'accepted'
    and profile.deleted_at is null
  where post.group_id = p_group_id and post.kind = 'group'
    and post.published_at is not null and post.deleted_at is null
    and (p_category_id is null or post.category_id = p_category_id)
    and (
      p_cursor_post_id is null
      or (
        p_cursor_is_pinned
        and (
          post.pinned_at is null
          or (
            post.pinned_at is not null
            and (post.published_at, post.id) < (p_cursor_published_at, p_cursor_post_id)
          )
        )
      )
      or (
        not p_cursor_is_pinned
        and post.pinned_at is null
        and (post.published_at, post.id) < (p_cursor_published_at, p_cursor_post_id)
      )
    )
  order by (post.pinned_at is not null) desc, post.published_at desc, post.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke all on function public.list_group_posts(uuid, uuid, timestamptz, uuid, boolean, integer)
  from public, anon;
grant execute on function public.list_group_posts(uuid, uuid, timestamptz, uuid, boolean, integer)
  to authenticated;

drop function public.get_group_post(uuid);

create function public.get_group_post(p_post_id uuid)
returns table (
  post_id uuid, group_id uuid, category_id uuid, category_name text,
  title text, body text, author_identity public.post_identity,
  author_pub_id text, author_name text, author_avatar_path text, author_label text,
  is_pinned boolean, published_at timestamptz, edited_at timestamptz,
  comment_count integer,
  is_author boolean, can_edit boolean, can_delete boolean, can_pin boolean
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
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
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

  return query
  select
    post.id, post.group_id, post.category_id, category.name,
    post.title, post.body, post.author_identity,
    case when post.author_identity in ('identified', 'staff') then profile.pub_id end,
    case when post.author_identity in ('identified', 'staff') then profile.name end,
    case when post.author_identity in ('identified', 'staff') then profile.avatar_path end,
    case post.author_identity
      when 'identified' then profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    post.pinned_at is not null, post.published_at, post.edited_at,
    post.comment_count,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id or caller_role in ('owner', 'admin'),
    caller_role in ('owner', 'admin', 'manager')
  from public.posts as post
  join private.post_authors as author on author.post_id = post.id
  left join public.group_categories as category on category.id = post.category_id
  left join public.profiles as profile
    on (
      (post.author_identity = 'identified' and profile.id = post.display_author_profile_id)
      or (post.author_identity = 'staff' and profile.id = author.profile_id)
    )
    and profile.status = 'accepted'
    and profile.deleted_at is null
  where post.id = p_post_id and post.kind = 'group'
    and post.published_at is not null and post.deleted_at is null;
end;
$$;

revoke all on function public.get_group_post(uuid) from public, anon;
grant execute on function public.get_group_post(uuid) to authenticated;
