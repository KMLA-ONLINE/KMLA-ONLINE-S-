-- 게시물 및 댓글 반응 (기능 명세 §10).
--
-- 반응 행은 통째로 신원이다. 게시물·댓글은 표현용 값(`author_identity`, `anon_alias_number`)과
-- 실제 작성자를 나눌 수 있었지만 반응에는 나눌 표현값이 없다 — 행이 곧 "누가, 무엇을, 언제"다.
-- 그래서 `private`로 쪼개는 대신 `post_comments`와 같이 클라이언트 grant를 아예 주지 않고,
-- 익명 반응자를 가리는 일은 전부 definer RPC 안에서 한다.
--
-- 반응 수와 상위 반응은 비정규화하지 않는다. `posts.comment_count`와 달리 상위 반응 배열은
-- 트리거로 유지하기 까다롭고(반응 변경 한 번이 두 종류의 순위를 동시에 흔든다), 한 페이지는
-- 20개 게시물이라 `(post_id, reaction)` 인덱스를 타는 lateral 집계로 충분하다.

create type public.post_reaction as enum ('like', 'love', 'haha', 'wow', 'sad', 'angry');

-- 익명 여부는 쓰는 시점의 그룹 정책으로 정해 행에 박아 둔다(기능 명세 §10.4). 읽을 때마다
-- 정책을 다시 보면, 그룹이 나중에 익명 해제로 바뀌는 순간 익명을 약속받고 눌렀던 과거 반응까지
-- 실명으로 드러난다.
create table public.post_reactions (
  post_id uuid not null references public.posts (id) on delete cascade,
  profile_id bigint not null references public.profiles (id),
  reaction public.post_reaction not null,
  is_anonymous boolean not null,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);

create index post_reactions_summary_idx
  on public.post_reactions (post_id, reaction);

alter table public.post_reactions enable row level security;
revoke all on table public.post_reactions from anon, authenticated;

create policy "post_reactions_deny_client_access"
on public.post_reactions
for all
to public
using (false)
with check (false);

create table public.comment_reactions (
  comment_id uuid not null references public.post_comments (id) on delete cascade,
  profile_id bigint not null references public.profiles (id),
  reaction public.post_reaction not null,
  is_anonymous boolean not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, profile_id)
);

create index comment_reactions_summary_idx
  on public.comment_reactions (comment_id, reaction);

alter table public.comment_reactions enable row level security;
revoke all on table public.comment_reactions from anon, authenticated;

create policy "comment_reactions_deny_client_access"
on public.comment_reactions
for all
to public
using (false)
with check (false);

-- 쓰기 경로가 공통으로 확인하는 것: 호출자가 그 그룹 멤버인가, 그리고 이 그룹에서 반응은
-- 익명으로 저장되는가. `posting_policy`는 보지 않는다 — 운영진 작성 그룹에서도 모든 멤버가
-- 반응을 남길 수 있다(기능 명세 §8.2).
create function private.reaction_context(
  p_post_id uuid,
  p_caller_profile_id bigint,
  out is_anonymous boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  group_record public.groups;
  caller_role public.group_member_role;
begin
  select group_data.* into group_record
  from public.groups as group_data
  join public.posts as post on post.group_id = group_data.id
  where post.id = p_post_id and post.kind = 'group'
    and post.published_at is not null and post.deleted_at is null;
  if group_record.id is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;

  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = group_record.id
    and membership.profile_id = p_caller_profile_id;
  if caller_role is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  is_anonymous := group_record.identity_policy = 'always_anonymous';
end;
$$;

revoke all on function private.reaction_context(uuid, bigint) from public, anon, authenticated;

-- 요약 계산. 총 반응 수, 많이 쓰인 상위 3종, 그리고 호출자 본인의 반응이다(기능 명세 §10.1).
-- 상위 3종은 같은 수일 때 enum 순서로 갈라 결과가 매번 흔들리지 않게 한다.
create function private.post_reaction_summary(
  p_post_id uuid,
  p_caller_profile_id bigint
)
returns table (
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction
)
language sql
stable
security definer
set search_path = ''
as $$
  with tally as (
    select
      entry.reaction,
      count(*)::integer as n,
      row_number() over (order by count(*) desc, entry.reaction) as rank
    from public.post_reactions as entry
    where entry.post_id = p_post_id
    group by entry.reaction
  )
  select
    coalesce((select sum(tally.n)::integer from tally), 0),
    coalesce(
      (
        select array_agg(ranked.reaction order by ranked.n desc, ranked.reaction)
        from tally as ranked
        where ranked.rank <= 3
      ),
      array[]::public.post_reaction[]
    ),
    (
      select mine.reaction
      from public.post_reactions as mine
      where mine.post_id = p_post_id and mine.profile_id = p_caller_profile_id
    );
$$;

revoke all on function private.post_reaction_summary(uuid, bigint)
  from public, anon, authenticated;

create function private.comment_reaction_summary(
  p_comment_id uuid,
  p_caller_profile_id bigint
)
returns table (
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction
)
language sql
stable
security definer
set search_path = ''
as $$
  with tally as (
    select
      entry.reaction,
      count(*)::integer as n,
      row_number() over (order by count(*) desc, entry.reaction) as rank
    from public.comment_reactions as entry
    where entry.comment_id = p_comment_id
    group by entry.reaction
  )
  select
    coalesce((select sum(tally.n)::integer from tally), 0),
    coalesce(
      (
        select array_agg(ranked.reaction order by ranked.n desc, ranked.reaction)
        from tally as ranked
        where ranked.rank <= 3
      ),
      array[]::public.post_reaction[]
    ),
    (
      select mine.reaction
      from public.comment_reactions as mine
      where mine.comment_id = p_comment_id and mine.profile_id = p_caller_profile_id
    );
$$;

revoke all on function private.comment_reaction_summary(uuid, bigint)
  from public, anon, authenticated;

create function public.set_post_reaction(
  p_post_id uuid,
  p_reaction public.post_reaction
)
returns table (
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  anonymous boolean;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  anonymous := private.reaction_context(p_post_id, caller_profile_id);

  -- 반응을 바꾸는 것도 새로 누르는 것이다. `created_at`을 갱신해야 반응자 목록의 "최근 반응순"이
  -- 지금 남아 있는 반응의 시각을 가리킨다(기능 명세 §10.3).
  insert into public.post_reactions as target (post_id, profile_id, reaction, is_anonymous)
  values (p_post_id, caller_profile_id, p_reaction, anonymous)
  on conflict (post_id, profile_id) do update
  set reaction = excluded.reaction,
      is_anonymous = excluded.is_anonymous,
      created_at = now()
  where target.reaction is distinct from excluded.reaction
     or target.is_anonymous is distinct from excluded.is_anonymous;

  return query select * from private.post_reaction_summary(p_post_id, caller_profile_id);
end;
$$;

revoke all on function public.set_post_reaction(uuid, public.post_reaction) from public, anon;
grant execute on function public.set_post_reaction(uuid, public.post_reaction) to authenticated;

create function public.clear_post_reaction(p_post_id uuid)
returns table (
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  perform private.reaction_context(p_post_id, caller_profile_id);

  delete from public.post_reactions as target
  where target.post_id = p_post_id and target.profile_id = caller_profile_id;

  return query select * from private.post_reaction_summary(p_post_id, caller_profile_id);
end;
$$;

revoke all on function public.clear_post_reaction(uuid) from public, anon;
grant execute on function public.clear_post_reaction(uuid) to authenticated;

create function public.set_comment_reaction(
  p_comment_id uuid,
  p_reaction public.post_reaction
)
returns table (
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_post_id uuid;
  anonymous boolean;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  -- 삭제된 댓글은 tombstone으로만 남는다. 본문도 작성자도 없는 자리에 반응을 붙일 수 없다.
  select comment.post_id into target_post_id
  from public.post_comments as comment
  where comment.id = p_comment_id and comment.deleted_at is null;
  if target_post_id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  anonymous := private.reaction_context(target_post_id, caller_profile_id);

  insert into public.comment_reactions as target
    (comment_id, profile_id, reaction, is_anonymous)
  values (p_comment_id, caller_profile_id, p_reaction, anonymous)
  on conflict (comment_id, profile_id) do update
  set reaction = excluded.reaction,
      is_anonymous = excluded.is_anonymous,
      created_at = now()
  where target.reaction is distinct from excluded.reaction
     or target.is_anonymous is distinct from excluded.is_anonymous;

  return query select * from private.comment_reaction_summary(p_comment_id, caller_profile_id);
end;
$$;

revoke all on function public.set_comment_reaction(uuid, public.post_reaction) from public, anon;
grant execute on function public.set_comment_reaction(uuid, public.post_reaction) to authenticated;

create function public.clear_comment_reaction(p_comment_id uuid)
returns table (
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_post_id uuid;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select comment.post_id into target_post_id
  from public.post_comments as comment
  where comment.id = p_comment_id and comment.deleted_at is null;
  if target_post_id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  perform private.reaction_context(target_post_id, caller_profile_id);

  delete from public.comment_reactions as target
  where target.comment_id = p_comment_id and target.profile_id = caller_profile_id;

  return query select * from private.comment_reaction_summary(p_comment_id, caller_profile_id);
end;
$$;

revoke all on function public.clear_comment_reaction(uuid) from public, anon;
grant execute on function public.clear_comment_reaction(uuid) to authenticated;

-- 반응 참여자 목록 (기능 명세 §10.3). 실명 반응자는 한 줄씩, 익명 반응은 개인을 드러내지 않고
-- 반응 종류별 인원수 한 줄로 접어 내린다. 익명 줄은 `reactor_pub_id is null`로 구분한다.
--
-- 답글 묶음과 같은 이유로 페이지를 자르지 않는다. 학교 규모의 그룹에서 한 게시물의 반응은
-- 한 화면에 담기는 수준이고, 자르면 목록에 보이는 수와 요약의 총계가 어긋난다.
create function public.list_post_reactors(p_post_id uuid)
returns table (
  reaction public.post_reaction,
  reactor_pub_id text,
  reactor_name text,
  reactor_avatar_path text,
  reacted_at timestamptz,
  anonymous_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  perform private.reaction_context(p_post_id, caller_profile_id);

  return query
  select
    grouped.reaction,
    null::text,
    null::text,
    null::text,
    null::timestamptz,
    count(*)::integer
  from public.post_reactions as grouped
  where grouped.post_id = p_post_id and grouped.is_anonymous
  group by grouped.reaction

  union all

  select
    entry.reaction,
    profile.pub_id,
    profile.name,
    profile.avatar_path,
    entry.created_at,
    null::integer
  from public.post_reactions as entry
  left join public.profiles as profile
    on profile.id = entry.profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  where entry.post_id = p_post_id and not entry.is_anonymous

  -- 익명 묶음이 먼저, 그다음 실명 반응자가 최근순이다.
  order by 6 desc nulls last, 5 desc;
end;
$$;

revoke all on function public.list_post_reactors(uuid) from public, anon;
grant execute on function public.list_post_reactors(uuid) to authenticated;

-- 게시물 카드·상세와 댓글이 모두 반응 요약을 보여줘야 하므로 읽기 RPC의 반환 모양이 바뀐다.
-- 반환 테이블에 컬럼을 더하는 것은 `create or replace`로 안 되므로 통째로 다시 만들고, 그때
-- grant를 다시 발급해야 한다. 검색 결과에는 반응을 표시하지 않으므로(기능 명세 §8.9)
-- `search_group_posts`는 그대로 둔다.

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
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction,
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
    summary.total,
    summary.top,
    mine.reaction,
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
  left join public.post_reactions as mine
    on mine.post_id = post.id and mine.profile_id = caller_profile_id
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
      from public.post_reactions as entry
      where entry.post_id = post.id
      group by entry.reaction
    ) as tally
  ) as summary on true
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
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction,
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
    summary.total,
    summary.top,
    mine.reaction,
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
  left join public.post_reactions as mine
    on mine.post_id = post.id and mine.profile_id = caller_profile_id
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
      from public.post_reactions as entry
      where entry.post_id = post.id
      group by entry.reaction
    ) as tally
  ) as summary on true
  where post.id = p_post_id and post.kind = 'group'
    and post.published_at is not null and post.deleted_at is null;
end;
$$;

revoke all on function public.get_group_post(uuid) from public, anon;
grant execute on function public.get_group_post(uuid) to authenticated;

-- 댓글 쪽은 네 개의 공개 RPC가 모두 `private.read_post_comments`의 결과를 그대로 흘려보낸다.
-- 실제 반응 계산은 이 함수 하나만 고치면 되고, 나머지는 `returns table`만 늘어난다.
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
    -- 삭제된 댓글에는 반응을 붙일 수 없으므로 tombstone의 요약은 비운다. 지우기 전에 달려 있던
    -- 반응 행은 남아 있지만, 자국만 남은 자리에 남의 반응 수를 보여줄 이유가 없다.
    case when comment.deleted_at is null then summary.total else 0 end,
    case
      when comment.deleted_at is null then summary.top
      else array[]::public.post_reaction[]
    end,
    case when comment.deleted_at is null then mine.reaction end,
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
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction,
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
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction,
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
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction,
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
