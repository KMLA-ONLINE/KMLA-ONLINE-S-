-- 댓글 반응 참여자 목록을 열고(기능 명세 §10.3), 부모가 삭제돼도 답글의 `@작성자`를 남긴다.

-- 게시물과 같은 모양으로 내려준다. 실명 반응자는 한 줄씩, 익명 반응은 종류별 인원수 한 줄이다.
-- 삭제된 댓글은 요약 자체를 비우므로(`read_post_comments`) 목록을 열 일도 없다.
create function public.list_comment_reactors(p_comment_id uuid)
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

  return query
  select
    grouped.reaction,
    null::text,
    null::text,
    null::text,
    null::timestamptz,
    count(*)::integer
  from public.comment_reactions as grouped
  where grouped.comment_id = p_comment_id and grouped.is_anonymous
  group by grouped.reaction

  union all

  select
    entry.reaction,
    profile.pub_id,
    profile.name,
    profile.avatar_path,
    entry.created_at,
    null::integer
  from public.comment_reactions as entry
  left join public.profiles as profile
    on profile.id = entry.profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  where entry.comment_id = p_comment_id and not entry.is_anonymous

  order by 6 desc nulls last, 5 desc;
end;
$$;

revoke all on function public.list_comment_reactors(uuid) from public, anon;
grant execute on function public.list_comment_reactors(uuid) to authenticated;

-- 부모가 삭제돼도 답글의 `@작성자`는 남긴다(기능 명세 §9.2).
--
-- 지우면 답글이 갑자기 최상위 댓글처럼 보인다. 누구에게 한 말인지 사라져서 엉뚱한 사람에게 한
-- 말로 읽히는데, tombstone을 남기는 이유가 바로 그 대화 연결을 지키는 것이다(기능 명세 §19.3).
-- 이름이 드러나는 것은 그 댓글이 살아 있는 동안 이미 보이던 것과 같다.
--
-- 반환 모양은 그대로라 `create or replace`로 충분하다. 이 함수를 흘려보내는 네 개의 공개 RPC는
-- 손대지 않아도 된다.
create or replace function private.read_post_comments(
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
    -- 자기 본문과 달리 부모의 이름은 부모가 지워져도 내려보낸다.
    case
      when parent.id is not null
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
