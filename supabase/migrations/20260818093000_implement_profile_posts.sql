-- 개인 게시물(기능 명세 §8.4, §12.4)을 실제 데이터에 연결한다.
--
-- 읽기 권한 판정은 지금까지 RLS·Storage 정책·RPC 네 곳에 "그룹 멤버냐"로 인라인 복제돼
-- 있었다. 개인 게시물이 들어오면 판정이 세 갈래(그룹 멤버 / 전체 공개 / 작성자 전용)가 되므로
-- 한 곳으로 모은다. 갈라지면 첨부는 보이는데 본문은 안 보이는 식으로 조용히 어긋난다.
create function private.can_read_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_profile_id() is not null
    and exists (
      select 1
      from public.posts as post
      where post.id = p_post_id
        and post.deleted_at is null
        and case
          -- 게시 전 초안은 첨부를 올리려는 작성자에게만 보인다.
          when post.published_at is null then private.is_post_author(post.id)
          when post.kind = 'group' then private.is_group_member(post.group_id)
          when post.visibility = 'public' then true
          -- 비공개 개인 게시물의 작성자는 CHECK상 타임라인 당사자와 같다.
          else private.is_post_author(post.id)
        end
    );
$$;

revoke all on function private.can_read_post(uuid) from public, anon;
grant execute on function private.can_read_post(uuid) to authenticated;

drop policy "posts_select_group_member_or_draft_author" on public.posts;
create policy "posts_select_readable"
on public.posts
for select
to authenticated
using (private.can_read_post(id));

drop policy "post_attachments_select_reader" on public.post_attachments;
create policy "post_attachments_select_reader"
on public.post_attachments
for select
to authenticated
using (
  status <> 'deleted'
  and (status = 'ready' or private.is_post_author(post_id))
  and private.can_read_post(post_id)
);

drop policy "post_attachments_storage_select_reader" on storage.objects;
create policy "post_attachments_storage_select_reader"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'post-attachments'
  and storage.allow_any_operation(array[
    'object.get_authenticated_info',
    'object.get_authenticated',
    'object.sign',
    'object.sign_many'
  ])
  and exists (
    select 1
    from public.post_attachments as attachment
    where attachment.storage_bucket = storage.objects.bucket_id
      and attachment.object_path = storage.objects.name
      and attachment.status = 'ready'
      and private.can_read_post(attachment.post_id)
  )
);

-- 개인 게시물의 공개 범위는 게시 후에도 작성자가 바꿀 수 있다(기능 명세 §8.10). 그래서
-- `visibility`만 불변 목록에서 조건부로 풀되, `commit_profile_post` 안에서만 열리는 플래그를
-- 건다 — 클라이언트에는 posts UPDATE 권한이 없으므로 이 트리거가 유일한 문지기다.
-- 게시 전환 규칙은 그대로 둔다. 여기에 같은 플래그를 걸면 플래그를 세우지 않는
-- `publish_group_post`가 함께 막힌다.
create or replace function private.prevent_post_immutable_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.kind is distinct from old.kind
    or new.group_id is distinct from old.group_id
    or new.timeline_profile_id is distinct from old.timeline_profile_id
    or new.author_identity is distinct from old.author_identity
    or new.display_author_profile_id is distinct from old.display_author_profile_id
    or new.body_format_version is distinct from old.body_format_version
    or new.created_at is distinct from old.created_at
    or (
      new.visibility is distinct from old.visibility
      and not (
        current_setting('app.commit_post', true) = '1'
        and old.kind = 'profile'
        and new.visibility is not null
      )
    )
    or (
      new.published_at is distinct from old.published_at
      and not (old.published_at is null and new.published_at is not null)
    ) then
    raise exception 'post identity and publication fields cannot be changed'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

-- 그룹과 개인 게시물이 공유하는 첨부 커밋 트랜잭션. 게시물 종류에 따라 갈리는 것은 제목·
-- 카테고리·공개 범위뿐이고, 첨부의 소유권·중복·업로드 메타데이터 검증과 순서 재배치는
-- 완전히 같다. 두 벌로 두면 한쪽만 고쳐졌을 때 첨부가 조용히 어긋난 채 저장된다.
create function private.apply_post_commit(
  p_post_id uuid,
  p_body text,
  p_attachment_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  attachment_count integer := cardinality(coalesce(p_attachment_ids, '{}'::uuid[]));
begin
  if char_length(coalesce(p_body, '')) > 20000 then
    raise exception 'body must contain between 0 and 20000 characters' using errcode = '22023';
  end if;
  if attachment_count > 10
    or attachment_count <> (
      select count(distinct attachment_id)
      from unnest(coalesce(p_attachment_ids, '{}'::uuid[])) as attachment_id
    ) then
    raise exception 'attachment order must contain at most 10 unique ids' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_attachment_ids, '{}'::uuid[])) as requested(id)
    where not exists (
      select 1 from public.post_attachments as attachment
      where attachment.id = requested.id
        and attachment.post_id = p_post_id
        and attachment.status <> 'deleted'
    )
  ) then
    raise exception 'attachment does not belong to this post' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.post_attachments as attachment
    left join storage.objects as object
      on object.bucket_id = attachment.storage_bucket
      and object.name = attachment.object_path
    where attachment.id = any(coalesce(p_attachment_ids, '{}'::uuid[]))
      and attachment.status = 'pending'
      and (
        object.id is null
        or object.owner_id is distinct from auth.uid()::text
        or nullif(object.metadata ->> 'size', '')::bigint is distinct from attachment.size_bytes
        or object.metadata ->> 'mimetype' is distinct from attachment.mime_type
      )
  ) then
    raise exception 'uploaded attachment metadata does not match' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null and attachment_count = 0 then
    raise exception 'post requires a body or ready attachment' using errcode = '22023';
  end if;

  update public.post_attachments
  set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
    cleanup_lease_expires_at = null
  where post_id = p_post_id
    and status <> 'deleted'
    and not (id = any(coalesce(p_attachment_ids, '{}'::uuid[])));

  -- 순서를 음수로 밀어 두고 다시 매긴다. `(post_id, position)` unique 제약을 중간 상태에서
  -- 밟지 않기 위한 것이다.
  update public.post_attachments
  set position = -position - 1
  where post_id = p_post_id and status <> 'deleted';

  update public.post_attachments as attachment
  set position = requested.ordinality - 1,
    status = 'ready',
    ready_at = coalesce(attachment.ready_at, now())
  from unnest(coalesce(p_attachment_ids, '{}'::uuid[]))
    with ordinality as requested(id, ordinality)
  where attachment.id = requested.id;
end;
$$;

revoke all on function private.apply_post_commit(uuid, text, uuid[]) from public, anon, authenticated;

create or replace function public.commit_group_post(
  p_post_id uuid,
  p_title text,
  p_body text,
  p_attachment_ids uuid[],
  p_publish boolean default false,
  p_category_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can commit this post' using errcode = '42501';
  end if;
  if not private.is_group_member(post_record.group_id) then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if coalesce(p_publish, false) and post_record.published_at is not null then
    raise exception 'post is already published' using errcode = '55000';
  end if;
  if nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 100 then
    raise exception 'title must contain between 1 and 100 characters' using errcode = '22023';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.group_categories as category
    where category.id = p_category_id and category.group_id = post_record.group_id
  ) then
    raise exception 'category must belong to the group' using errcode = '22023';
  end if;

  perform private.apply_post_commit(p_post_id, p_body, p_attachment_ids);

  update public.posts
  set title = btrim(p_title), body = coalesce(p_body, ''), category_id = p_category_id,
    published_at = case when coalesce(p_publish, false) then now() else published_at end,
    edited_at = case when published_at is not null then now() else null end
  where id = p_post_id;
  return p_post_id;
end;
$$;

-- 첨부 업로드는 부모 게시물 UUID를 먼저 요구하므로 개인 게시물도 초안부터 만든다. 초안은
-- `published_at`이 null이라 작성자 외에는 보이지 않는다.
create function public.create_profile_post(
  p_timeline_pub_id text,
  p_visibility public.post_visibility default 'public'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  timeline_profile public.profiles;
  new_post_id uuid := gen_random_uuid();
  chosen_visibility public.post_visibility;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  -- 타임라인은 화면과 같은 공개 ID로 가리킨다. 클라이언트가 프로필 숫자 ID를 먼저 알아내려고
  -- 왕복하지 않아도 되고, loader가 프로필과 타임라인을 나란히 부를 수 있다.
  --
  -- 타인 작성 허용 값을 읽고 게시물을 넣는 사이에 당사자가 설정을 끄는 창을 없앤다
  -- (STORAGE_BUCKETS.md: 타인 게시물 생성은 하나의 원자적 작업에서 다시 확인한다).
  select profile.* into timeline_profile
  from public.profiles as profile
  where profile.pub_id = lower(btrim(p_timeline_pub_id))
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;
  if timeline_profile.id is null then
    raise exception 'timeline owner not found' using errcode = 'P0002';
  end if;

  if timeline_profile.id = caller_profile_id then
    chosen_visibility := coalesce(p_visibility, 'public');
  else
    if not timeline_profile.allow_timeline_posts then
      raise exception 'timeline owner does not accept posts' using errcode = '42501';
    end if;
    -- 다른 사용자의 타임라인에 작성한 게시물은 즉시 전체 공개다(기능 명세 §8.4).
    chosen_visibility := 'public';
  end if;

  insert into public.posts (
    id, kind, body, timeline_profile_id, author_identity,
    display_author_profile_id, visibility
  ) values (
    new_post_id, 'profile', '', timeline_profile.id, 'identified',
    caller_profile_id, chosen_visibility
  );

  insert into private.post_authors (post_id, profile_id)
  values (new_post_id, caller_profile_id);

  return new_post_id;
end;
$$;

create function public.commit_profile_post(
  p_post_id uuid,
  p_body text,
  p_attachment_ids uuid[],
  p_publish boolean default false,
  p_visibility public.post_visibility default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  next_visibility public.post_visibility;
  content_changed boolean;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'profile' and post.deleted_at is null
  for update;
  -- 타임라인 당사자는 타인이 쓴 글을 수정할 수 없다(기능 명세 §12.4). 작성자만 통과한다.
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can commit this post' using errcode = '42501';
  end if;
  if coalesce(p_publish, false) and post_record.published_at is not null then
    raise exception 'post is already published' using errcode = '55000';
  end if;

  -- 공개 범위는 자기 타임라인 글에서만 고를 수 있다(기능 명세 §8.4).
  if post_record.timeline_profile_id = caller_profile_id then
    next_visibility := coalesce(p_visibility, post_record.visibility);
  else
    next_visibility := 'public';
  end if;

  -- 타인 작성 허용을 꺼도 기존 게시물은 유지하므로 수정은 막지 않는다. 아직 게시되지 않은
  -- 초안은 새 게시물이라, 게시하는 순간의 허용 값을 다시 본다(기능 명세 §8.4).
  if coalesce(p_publish, false)
    and post_record.timeline_profile_id <> caller_profile_id
    and not exists (
      select 1 from public.profiles as profile
      where profile.id = post_record.timeline_profile_id
        and profile.status = 'accepted'
        and profile.deleted_at is null
        and profile.allow_timeline_posts
    ) then
    raise exception 'timeline owner does not accept posts' using errcode = '42501';
  end if;

  -- 공개 범위만 바꾼 것은 수정이 아니다. 첨부를 재배치하기 전에 재어 두어야 원래 순서와
  -- 비교할 수 있다(`apply_post_commit`이 position과 status를 갈아엎는다).
  --
  -- `ready`만 세는 것이 핵심이다. 게시된 글에서 `finalize_post_attachment`는 새 첨부를
  -- `pending`으로 남기므로 `ready`가 곧 "이번 편집 전부터 있던 것"이다. `status <> 'deleted'`로
  -- 세면 방금 올린 첨부까지 들어가 양쪽 배열이 같아지고, 사진만 더한 수정이 수정이 아닌 것이
  -- 된다.
  content_changed := coalesce(p_body, '') is distinct from post_record.body
    or coalesce(p_attachment_ids, '{}'::uuid[]) is distinct from (
      select coalesce(array_agg(attachment.id order by attachment.position), '{}'::uuid[])
      from public.post_attachments as attachment
      where attachment.post_id = p_post_id and attachment.status = 'ready'
    );

  perform private.apply_post_commit(p_post_id, p_body, p_attachment_ids);

  perform set_config('app.commit_post', '1', true);
  update public.posts
  set body = coalesce(p_body, ''),
    visibility = next_visibility,
    published_at = case when coalesce(p_publish, false) then now() else published_at end,
    edited_at = case
      -- 지금 게시하는 글은 수정된 적이 없다.
      when published_at is null then null
      when content_changed then now()
      else edited_at
    end
  where id = p_post_id;
  return p_post_id;
end;
$$;

-- 작성자와 타임라인 당사자만 지울 수 있다(기능 명세 §8.12).
create function public.delete_profile_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'profile' and post.deleted_at is null
  for update;
  if post_record.id is null then
    raise exception 'post not found or not accessible' using errcode = '42501';
  end if;
  if not private.is_post_author(p_post_id)
    and post_record.timeline_profile_id <> caller_profile_id then
    raise exception 'post deletion is not allowed' using errcode = '42501';
  end if;

  update public.posts set deleted_at = now() where id = p_post_id;
  update public.post_attachments
  set status = 'deleted', deleted_at = now(), cleanup_lease_id = null,
    cleanup_lease_expires_at = null
  where post_id = p_post_id and status <> 'deleted';
end;
$$;

revoke all on function public.create_profile_post(text, public.post_visibility)
  from public, anon;
revoke all on function public.commit_profile_post(uuid, text, uuid[], boolean, public.post_visibility)
  from public, anon;
revoke all on function public.delete_profile_post(uuid) from public, anon;
grant execute on function public.create_profile_post(text, public.post_visibility)
  to authenticated;
grant execute on function public.commit_profile_post(uuid, text, uuid[], boolean, public.post_visibility)
  to authenticated;
grant execute on function public.delete_profile_post(uuid) to authenticated;

-- 목록과 상세가 같은 반환 모양을 쓰도록 투영을 한 곳에 둔다. 컬럼을 더하거나 빼면 두 공개
-- RPC 모두 drop 후 재생성하고 grant를 재발급해야 한다.
create function private.read_profile_posts(
  p_post_ids uuid[],
  p_caller_profile_id bigint
)
returns table (
  post_id uuid,
  body text,
  timeline_pub_id text,
  timeline_name text,
  author_pub_id text,
  author_name text,
  author_avatar_path text,
  visibility public.post_visibility,
  published_at timestamptz,
  edited_at timestamptz,
  comment_count integer,
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction,
  is_author boolean,
  can_edit boolean,
  can_delete boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    post.id,
    post.body,
    timeline.pub_id,
    timeline.name,
    author_profile.pub_id,
    author_profile.name,
    author_profile.avatar_path,
    post.visibility,
    post.published_at,
    post.edited_at,
    post.comment_count,
    summary.total,
    summary.top,
    mine.reaction,
    author.profile_id = p_caller_profile_id,
    -- 타임라인 당사자도 타인이 쓴 글은 수정하지 못한다(기능 명세 §12.4).
    author.profile_id = p_caller_profile_id,
    author.profile_id = p_caller_profile_id
      or post.timeline_profile_id = p_caller_profile_id
  from public.posts as post
  join private.post_authors as author on author.post_id = post.id
  -- 타임라인 당사자가 탈퇴하거나 승인이 풀리면 그 타임라인의 글은 사라진다. inner join인 것이
  -- 핵심이다 — 작성자 쪽처럼 null로 떨어뜨리면 주인 없는 타임라인의 글이 링크로 열린다.
  join public.profiles as timeline
    on timeline.id = post.timeline_profile_id
    and timeline.status = 'accepted'
    and timeline.deleted_at is null
  left join public.profiles as author_profile
    on author_profile.id = post.display_author_profile_id
    and author_profile.status = 'accepted'
    and author_profile.deleted_at is null
  left join public.post_reactions as mine
    on mine.post_id = post.id and mine.profile_id = p_caller_profile_id
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
  where post.id = any(p_post_ids)
    and post.kind = 'profile'
  order by post.published_at desc, post.id desc;
$$;

revoke all on function private.read_profile_posts(uuid[], bigint) from public, anon, authenticated;

-- 프로필 타임라인 (기능 명세 §12.4). 전체 공개 게시물과, 내 타임라인일 때 내가 쓴 비공개
-- 게시물을 최신순으로 함께 돌려준다.
create function public.list_profile_posts(
  p_timeline_pub_id text,
  p_cursor_published_at timestamptz default null,
  p_cursor_post_id uuid default null,
  p_limit integer default 20
)
returns table (
  post_id uuid,
  body text,
  timeline_pub_id text,
  timeline_name text,
  author_pub_id text,
  author_name text,
  author_avatar_path text,
  visibility public.post_visibility,
  published_at timestamptz,
  edited_at timestamptz,
  comment_count integer,
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction,
  is_author boolean,
  can_edit boolean,
  can_delete boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  -- 컬럼과 이름이 겹치면 plpgsql이 어느 쪽인지 가리지 못한다.
  target_profile_id bigint;
  page_ids uuid[];
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if (p_cursor_published_at is null) <> (p_cursor_post_id is null) then
    raise exception 'post cursor must be complete' using errcode = '22023';
  end if;

  select profile.id into target_profile_id
  from public.profiles as profile
  where profile.pub_id = lower(btrim(p_timeline_pub_id))
    and profile.status = 'accepted'
    and profile.deleted_at is null;
  if target_profile_id is null then
    return;
  end if;

  select array_agg(page.id) into page_ids
  from (
    select post.id
    from public.posts as post
    where post.timeline_profile_id = target_profile_id
      and post.kind = 'profile'
      and post.published_at is not null
      and post.deleted_at is null
      and (
        post.visibility = 'public'
        or exists (
          select 1 from private.post_authors as author
          where author.post_id = post.id and author.profile_id = caller_profile_id
        )
      )
      and (
        p_cursor_post_id is null
        or (post.published_at, post.id) < (p_cursor_published_at, p_cursor_post_id)
      )
    order by post.published_at desc, post.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) as page;

  return query
  select entry.*
  from private.read_profile_posts(
    coalesce(page_ids, '{}'::uuid[]), caller_profile_id
  ) as entry;
end;
$$;

create function public.get_profile_post(p_post_id uuid)
returns table (
  post_id uuid,
  body text,
  timeline_pub_id text,
  timeline_name text,
  author_pub_id text,
  author_name text,
  author_avatar_path text,
  visibility public.post_visibility,
  published_at timestamptz,
  edited_at timestamptz,
  comment_count integer,
  reaction_count integer,
  top_reactions public.post_reaction[],
  my_reaction public.post_reaction,
  is_author boolean,
  can_edit boolean,
  can_delete boolean
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
  -- 초안(`published_at is null`)은 첨부를 올리기 위한 내부 상태이지 사용자용 임시 저장이
  -- 아니다. 상세로도 수정으로도 열리지 않는다.
  if not exists (
    select 1 from public.posts as post
    where post.id = p_post_id and post.kind = 'profile'
      and post.published_at is not null and post.deleted_at is null
  ) or not private.can_read_post(p_post_id) then
    return;
  end if;

  return query
  select entry.*
  from private.read_profile_posts(array[p_post_id], caller_profile_id) as entry;
end;
$$;

revoke all on function public.list_profile_posts(text, timestamptz, uuid, integer)
  from public, anon;
revoke all on function public.get_profile_post(uuid) from public, anon;
grant execute on function public.list_profile_posts(text, timestamptz, uuid, integer)
  to authenticated;
grant execute on function public.get_profile_post(uuid) to authenticated;

-- 반응은 이 한 함수가 접근 판정과 익명 여부를 함께 정한다. 개인 게시물에는 그룹 신원 정책이
-- 없으므로 언제나 실명으로 남는다(기능 명세 §10.4).
create or replace function private.reaction_context(
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
  post_record public.posts;
  group_record public.groups;
  caller_role public.group_member_role;
begin
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id
    and post.published_at is not null and post.deleted_at is null;
  if post_record.id is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;

  if post_record.kind = 'profile' then
    if not private.can_read_post(p_post_id) then
      raise exception 'post is not accessible' using errcode = '42501';
    end if;
    is_anonymous := false;
    return;
  end if;

  select group_data.* into group_record
  from public.groups as group_data
  where group_data.id = post_record.group_id;
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

-- 댓글 RPC 세 개가 공유하는 게시물 판정. 그룹 게시물의 비멤버는 지금까지처럼 42501로 막고,
-- 개인 게시물은 읽을 수 없으면 조용히 비어 돌아간다 — 비공개 글의 존재 자체를 알리지 않는다.
create function private.comment_post_context(
  p_post_id uuid,
  p_caller_profile_id bigint,
  out is_visible boolean,
  out post_kind public.post_kind,
  out caller_role public.group_member_role,
  out identity_policy public.group_identity_policy,
  out post_author_identity public.post_identity
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  post_record public.posts;
begin
  is_visible := false;

  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id
    and post.published_at is not null
    and post.deleted_at is null;
  if post_record.id is null then
    return;
  end if;
  post_kind := post_record.kind;
  post_author_identity := post_record.author_identity;

  if post_record.kind = 'group' then
    select membership.role into caller_role
    from public.group_memberships as membership
    where membership.group_id = post_record.group_id
      and membership.profile_id = p_caller_profile_id;
    if caller_role is null then
      raise exception 'group membership required' using errcode = '42501';
    end if;
    select group_data.identity_policy into identity_policy
    from public.groups as group_data
    where group_data.id = post_record.group_id;
    is_visible := true;
    return;
  end if;

  -- 전체 공개 개인 게시물은 승인 사용자 전체가, 비공개는 작성자 본인만 읽고 쓴다
  -- (기능 명세 §9.1). `caller_role`은 null로 남아 타인 댓글 삭제 권한이 생기지 않는다.
  is_visible := private.can_read_post(p_post_id);
end;
$$;

revoke all on function private.comment_post_context(uuid, bigint) from public, anon, authenticated;

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
    coalesce(page_ids, '{}'::uuid[]), caller_profile_id, context.caller_role
  ) as entry;
end;
$$;

create or replace function public.list_post_comment_replies(p_root_comment_id uuid)
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
  context record;
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

  context := private.comment_post_context(root_post_id, caller_profile_id);
  if not context.is_visible then
    return;
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
    coalesce(visible_ids, '{}'::uuid[]), caller_profile_id, context.caller_role
  ) as entry;
end;
$$;

create or replace function public.create_post_comment(
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
  context record;
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

  context := private.comment_post_context(p_post_id, caller_profile_id);
  if context.post_kind is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if not context.is_visible then
    raise exception 'post is not accessible' using errcode = '42501';
  end if;

  if context.post_kind = 'profile' then
    -- 개인 게시물 댓글은 항상 실명이다(기능 명세 §8.4, §9.1).
    if p_author_identity <> 'identified' then
      raise exception 'profile post comments must be identified' using errcode = '42501';
    end if;
  else
    -- `posting_policy`는 확인하지 않는다. 운영진 작성 그룹에서도 모든 멤버가 댓글을 남길 수
    -- 있다(기능 명세 §8.2).
    if p_author_identity = 'identified'
      and context.identity_policy = 'always_anonymous' then
      raise exception 'identified commenting is not allowed' using errcode = '42501';
    end if;
    if p_author_identity = 'anonymous'
      and context.identity_policy = 'identified' then
      raise exception 'anonymous commenting is not allowed' using errcode = '42501';
    end if;
    if p_author_identity = 'staff'
      and context.caller_role not in ('owner', 'admin', 'manager') then
      raise exception 'staff identity is not allowed' using errcode = '42501';
    end if;
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
    if context.post_author_identity = 'anonymous'
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
    array[new_comment_id], caller_profile_id, context.caller_role
  ) as entry;
end;
$$;

-- `p_caller_role`은 개인 게시물에서 null이다. `false or null`이 null이라 타인 댓글의
-- `can_delete`가 boolean이 아닌 null로 새어 나갔다. 그룹에서는 비멤버가 여기까지 오지 못해
-- 드러나지 않던 구멍이다. 반환 모양은 그대로라 grant는 유지된다.
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
        or coalesce(p_caller_role in ('owner', 'admin'), false)
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

-- 첨부 준비만 `kind = 'group'`에 묶여 있어 개인 게시물에는 사진도 파일도 붙지 않았다.
-- 나머지 첨부 RPC(finalize·delete·reorder·list)는 처음부터 `post_id`와 작성자만 보므로
-- 여기 한 줄이 파이프라인 첫 단계를 막고 있던 셈이다. 작성자 판정은 그대로 둔다.
create or replace function public.prepare_post_attachment(
  p_post_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_width integer default null,
  p_height integer default null
)
returns public.post_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_record public.posts;
  attachment public.post_attachments;
  attachment_id uuid := gen_random_uuid();
  next_position integer;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record from public.posts as post
  where post.id = p_post_id and post.deleted_at is null
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can add attachments' using errcode = '42501';
  end if;
  if (select count(*) from public.post_attachments
      where post_id = p_post_id and status <> 'deleted') >= 10 then
    raise exception 'a post can have at most 10 attachments' using errcode = '23514';
  end if;

  select coalesce(min(candidate), 0) into next_position
  from generate_series(0, 9) as candidate
  where not exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status <> 'deleted' and position = candidate
  );

  insert into public.post_attachments (
    id, post_id, object_path, original_filename, position, mime_type,
    size_bytes, width, height
  ) values (
    attachment_id, p_post_id, p_post_id::text || '/' || attachment_id::text,
    btrim(p_original_filename), next_position, btrim(p_mime_type),
    p_size_bytes, p_width, p_height
  ) returning * into attachment;
  return attachment;
end;
$$;
