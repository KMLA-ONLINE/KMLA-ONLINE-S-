create type public.profile_media_activity_kind as enum (
  'avatar_changed',
  'cover_changed'
);

alter table public.posts
add column activity_kind public.profile_media_activity_kind,
add column activity_media_path text,
add constraint posts_profile_activity_pair check (
  (activity_kind is null) = (activity_media_path is null)
),
add constraint posts_profile_activity_shape check (
  activity_kind is null
  or (
    kind = 'profile'
    and timeline_profile_id = display_author_profile_id
    and visibility = 'public'
    and body = ''
    and published_at is not null
    and activity_media_path like timeline_profile_id::text || '/'
      || case activity_kind
        when 'avatar_changed' then 'avatar'
        when 'cover_changed' then 'cover'
      end || '/%'
  )
);

create unique index posts_profile_activity_media_path_key
on public.posts (activity_media_path)
where activity_media_path is not null;

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
    or new.activity_kind is distinct from old.activity_kind
    or new.activity_media_path is distinct from old.activity_media_path
    or new.created_at is distinct from old.created_at
    or (
      new.visibility is distinct from old.visibility
      and not (
        current_setting('app.commit_post', true) = '1'
        and old.kind = 'profile'
        and old.activity_kind is null
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

create function private.prevent_profile_activity_attachments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.posts as post
    where post.id = new.post_id
      and post.activity_kind is not null
  ) then
    raise exception 'profile activity posts cannot have attachments'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_profile_activity_attachments() from public;

create trigger post_attachments_prevent_profile_activity
before insert or update of post_id on public.post_attachments
for each row execute function private.prevent_profile_activity_attachments();

create or replace function public.set_my_profile_media(
  p_slot text,
  p_object_path text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  current_profile public.profiles;
  updated_profile public.profiles;
  activity_post_id uuid := gen_random_uuid();
  activity_kind public.profile_media_activity_kind;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_slot not in ('avatar', 'cover') then
    raise exception 'invalid profile media slot' using errcode = '22023';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;

  if current_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_object_path not like current_profile.id::text || '/' || p_slot || '/%' then
    raise exception 'invalid profile media path' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'profile-media'
      and object.name = p_object_path
      and object.owner_id = caller_id::text
  ) then
    raise exception 'uploaded profile media required' using errcode = '22023';
  end if;

  if (p_slot = 'avatar' and current_profile.avatar_path = p_object_path)
    or (p_slot = 'cover' and current_profile.cover_path = p_object_path) then
    return current_profile;
  end if;

  if p_slot = 'avatar' then
    activity_kind := 'avatar_changed';
    update public.profiles
    set avatar_path = p_object_path
    where id = current_profile.id
    returning * into updated_profile;
  else
    activity_kind := 'cover_changed';
    update public.profiles
    set cover_path = p_object_path
    where id = current_profile.id
    returning * into updated_profile;
  end if;

  insert into public.posts (
    id,
    kind,
    body,
    timeline_profile_id,
    author_identity,
    display_author_profile_id,
    visibility,
    published_at,
    activity_kind,
    activity_media_path
  ) values (
    activity_post_id,
    'profile',
    '',
    current_profile.id,
    'identified',
    current_profile.id,
    'public',
    now(),
    activity_kind,
    p_object_path
  );

  insert into private.post_authors (post_id, profile_id)
  values (activity_post_id, current_profile.id);

  return updated_profile;
end;
$$;

revoke all on function public.set_my_profile_media(text, text) from public, anon;
grant execute on function public.set_my_profile_media(text, text) to authenticated;

create or replace function private.can_read_profile_media_path(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as viewer
    where viewer.auth_user_id = auth.uid()
      and viewer.status = 'accepted'
      and viewer.deleted_at is null
  )
  and (
    exists (
      select 1
      from public.profiles as target
      where target.status = 'accepted'
        and target.deleted_at is null
        and p_object_path in (target.avatar_path, target.cover_path)
    )
    or exists (
      select 1
      from public.posts as post
      join public.profiles as timeline
        on timeline.id = post.timeline_profile_id
        and timeline.status = 'accepted'
        and timeline.deleted_at is null
      where post.activity_media_path = p_object_path
        and post.published_at is not null
        and post.deleted_at is null
        and private.can_read_post(post.id)
    )
  );
$$;

revoke all on function private.can_read_profile_media_path(text) from public, anon;
grant execute on function private.can_read_profile_media_path(text) to authenticated;

create function private.can_delete_own_profile_media_path(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_own_profile_media_path(p_object_path)
    and not exists (
      select 1
      from public.profiles as profile
      where p_object_path in (profile.avatar_path, profile.cover_path)
    )
    and not exists (
      select 1
      from public.posts as post
      where post.activity_media_path = p_object_path
        and post.deleted_at is null
    );
$$;

revoke all on function private.can_delete_own_profile_media_path(text) from public, anon;
grant execute on function private.can_delete_own_profile_media_path(text) to authenticated;

drop policy "profile_media_delete_own" on storage.objects;
create policy "profile_media_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-media'
  and owner_id = (select auth.uid()::text)
  and private.can_delete_own_profile_media_path(name)
);

drop function public.list_profile_posts(text, timestamptz, uuid, integer);
drop function public.get_profile_post(uuid);
drop function private.read_profile_posts(uuid[], bigint);

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
  activity_kind public.profile_media_activity_kind,
  activity_media_path text,
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
    post.activity_kind,
    post.activity_media_path,
    post.visibility,
    post.published_at,
    post.edited_at,
    post.comment_count,
    summary.total,
    summary.top,
    mine.reaction,
    author.profile_id = p_caller_profile_id,
    author.profile_id = p_caller_profile_id and post.activity_kind is null,
    author.profile_id = p_caller_profile_id
      or post.timeline_profile_id = p_caller_profile_id
  from public.posts as post
  join private.post_authors as author on author.post_id = post.id
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
  activity_kind public.profile_media_activity_kind,
  activity_media_path text,
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
  activity_kind public.profile_media_activity_kind,
  activity_media_path text,
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
