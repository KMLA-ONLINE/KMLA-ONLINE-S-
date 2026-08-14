create policy "group_categories_select_member"
on public.group_categories
for select
to authenticated
using (private.is_group_member(group_id));

create policy "group_categories_insert_staff"
on public.group_categories
for insert
to authenticated
with check (
  current_setting('app.mutate_group_category', true) = '1'
  and
  exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = group_categories.group_id
      and membership.profile_id = private.current_profile_id()
      and membership.role in ('owner', 'admin', 'manager')
  )
);

create policy "group_categories_update_staff"
on public.group_categories
for update
to authenticated
using (
  current_setting('app.mutate_group_category', true) = '1'
  and
  exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = group_categories.group_id
      and membership.profile_id = private.current_profile_id()
      and membership.role in ('owner', 'admin', 'manager')
  )
)
with check (
  current_setting('app.mutate_group_category', true) = '1'
  and
  exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = group_categories.group_id
      and membership.profile_id = private.current_profile_id()
      and membership.role in ('owner', 'admin', 'manager')
  )
);

create policy "group_categories_delete_staff"
on public.group_categories
for delete
to authenticated
using (
  current_setting('app.mutate_group_category', true) = '1'
  and
  exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = group_categories.group_id
      and membership.profile_id = private.current_profile_id()
      and membership.role in ('owner', 'admin', 'manager')
  )
);

create policy "posts_select_group_member"
on public.posts
for select
to authenticated
using (
  kind = 'group'
  and published_at is not null
  and deleted_at is null
  and private.is_group_member(group_id)
);

create policy "posts_update_pin_staff"
on public.posts
for update
to authenticated
using (
  current_setting('app.set_group_post_pinned', true) = '1'
  and kind = 'group'
  and published_at is not null
  and deleted_at is null
  and exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = posts.group_id
      and membership.profile_id = private.current_profile_id()
      and membership.role in ('owner', 'admin', 'manager')
  )
)
with check (
  current_setting('app.set_group_post_pinned', true) = '1'
  and kind = 'group'
  and published_at is not null
  and deleted_at is null
  and exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = posts.group_id
      and membership.profile_id = private.current_profile_id()
      and membership.role in ('owner', 'admin', 'manager')
  )
);

grant select, insert, update (name, position), delete
on table public.group_categories to authenticated;
grant select on table public.posts to authenticated;
grant update (pinned_at) on table public.posts to authenticated;

create function public.create_group_category(
  p_group_id uuid,
  p_name text,
  p_position integer default null
)
returns public.group_categories
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_category public.group_categories;
  chosen_position integer;
begin
  perform set_config('app.mutate_group_category', '1', true);

  chosen_position := coalesce(
    p_position,
    (
      select coalesce(max(category.position) + 1, 0)
      from public.group_categories as category
      where category.group_id = p_group_id
    )
  );

  insert into public.group_categories (group_id, name, position)
  values (p_group_id, btrim(p_name), chosen_position)
  returning * into created_category;

  return created_category;
end;
$$;

create function public.update_group_category(
  p_category_id uuid,
  p_name text,
  p_position integer
)
returns public.group_categories
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_category public.group_categories;
begin
  perform set_config('app.mutate_group_category', '1', true);

  update public.group_categories
  set name = btrim(p_name), position = p_position
  where id = p_category_id
  returning * into updated_category;

  if updated_category.id is null then
    raise exception 'category not found or not accessible' using errcode = 'P0002';
  end if;

  return updated_category;
end;
$$;

create function public.delete_group_category(p_category_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform set_config('app.mutate_group_category', '1', true);

  delete from public.group_categories where id = p_category_id;
  if not found then
    raise exception 'category not found or not accessible' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.create_group_category(uuid, text, integer) from public;
revoke all on function public.update_group_category(uuid, text, integer) from public;
revoke all on function public.delete_group_category(uuid) from public;
grant execute on function public.create_group_category(uuid, text, integer) to authenticated;
grant execute on function public.update_group_category(uuid, text, integer) to authenticated;
grant execute on function public.delete_group_category(uuid) to authenticated;

create function private.prevent_post_immutable_changes()
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
    or new.visibility is distinct from old.visibility
    or new.body_format_version is distinct from old.body_format_version
    or new.created_at is distinct from old.created_at
    or new.published_at is distinct from old.published_at then
    raise exception 'post identity and publication fields cannot be changed'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_post_immutable_changes() from public;

create trigger posts_prevent_immutable_changes
before update on public.posts
for each row execute function private.prevent_post_immutable_changes();

-- This helper is the only read path that touches the private actual-author row.
-- It reveals profile data only for identified posts and only to group members.
create function private.group_post_access(p_post_id uuid)
returns table (
  author_pub_id uuid,
  author_name text,
  author_avatar_path text,
  author_label text,
  is_author boolean,
  can_edit boolean,
  can_delete boolean,
  can_pin boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  caller_role public.group_member_role;
  actual_author_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id
    and post.kind = 'group'
    and post.published_at is not null
    and post.deleted_at is null;

  if post_record.id is null then
    return;
  end if;

  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = post_record.group_id
    and membership.profile_id = caller_profile_id;

  if caller_role is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  select author.profile_id into actual_author_id
  from private.post_authors as author
  where author.post_id = post_record.id;

  return query
  select
    case when post_record.author_identity = 'identified' then profile.pub_id end,
    case when post_record.author_identity = 'identified' then profile.name end,
    case when post_record.author_identity = 'identified' then profile.avatar_path end,
    case post_record.author_identity
      when 'identified' then profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    actual_author_id = caller_profile_id,
    actual_author_id = caller_profile_id,
    actual_author_id = caller_profile_id or caller_role in ('owner', 'admin'),
    caller_role in ('owner', 'admin', 'manager')
  from (select 1) as singleton
  left join public.profiles as profile
    on profile.id = post_record.display_author_profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null;
end;
$$;

revoke all on function private.group_post_access(uuid) from public;
grant execute on function private.group_post_access(uuid) to authenticated;

create function public.create_group_post(
  p_group_id uuid,
  p_title text,
  p_body text,
  p_author_identity public.post_identity,
  p_category_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  group_record public.groups;
  member_role public.group_member_role;
  created_post_id uuid;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select group_data.*
  into group_record
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id
    and membership.profile_id = caller_profile_id
  where group_data.id = p_group_id;

  select membership.role
  into member_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id;

  if group_record.id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if group_record.posting_policy = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'group posting is restricted to staff' using errcode = '42501';
  end if;
  if p_author_identity = 'identified'
    and group_record.identity_policy = 'always_anonymous' then
    raise exception 'identified posting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous'
    and group_record.identity_policy = 'identified' then
    raise exception 'anonymous posting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 100 then
    raise exception 'title must contain between 1 and 100 characters' using errcode = '22023';
  end if;
  if nullif(btrim(p_body), '') is null or char_length(p_body) > 20000 then
    raise exception 'body must contain between 1 and 20000 characters' using errcode = '22023';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.group_categories as category
    where category.id = p_category_id and category.group_id = p_group_id
  ) then
    raise exception 'category must belong to the group' using errcode = '22023';
  end if;

  insert into public.posts (
    kind, body, group_id, title, category_id, author_identity,
    display_author_profile_id, published_at
  ) values (
    'group', p_body, p_group_id, btrim(p_title), p_category_id, p_author_identity,
    case when p_author_identity = 'identified' then caller_profile_id end, now()
  ) returning id into created_post_id;

  insert into private.post_authors (post_id, profile_id)
  values (created_post_id, caller_profile_id);

  return created_post_id;
end;
$$;

create function public.update_group_post(
  p_post_id uuid,
  p_title text,
  p_body text,
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
  select post.* into post_record from public.posts as post
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null
  for update;
  if post_record.id is null or not exists (
    select 1 from private.post_authors as author
    where author.post_id = p_post_id and author.profile_id = caller_profile_id
  ) then
    raise exception 'only the author can update this post' using errcode = '42501';
  end if;
  if not private.is_group_member(post_record.group_id) then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 100 then
    raise exception 'title must contain between 1 and 100 characters' using errcode = '22023';
  end if;
  if nullif(btrim(p_body), '') is null or char_length(p_body) > 20000 then
    raise exception 'body must contain between 1 and 20000 characters' using errcode = '22023';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.group_categories as category
    where category.id = p_category_id and category.group_id = post_record.group_id
  ) then
    raise exception 'category must belong to the group' using errcode = '22023';
  end if;

  update public.posts
  set title = btrim(p_title), body = p_body, category_id = p_category_id, edited_at = now()
  where id = p_post_id;
  return p_post_id;
end;
$$;

create function public.delete_group_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  caller_role public.group_member_role;
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
  if caller_role not in ('owner', 'admin') and not exists (
    select 1 from private.post_authors as author
    where author.post_id = p_post_id and author.profile_id = caller_profile_id
  ) then
    raise exception 'post deletion is not allowed' using errcode = '42501';
  end if;
  update public.posts set deleted_at = now(), pinned_at = null where id = p_post_id;
end;
$$;

create function public.set_group_post_pinned(p_post_id uuid, p_pinned boolean)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_group_id uuid;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  perform set_config('app.set_group_post_pinned', '1', true);
  select post.group_id into post_group_id from public.posts as post
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null
  for update;
  if post_group_id is null or not exists (
    select 1 from public.group_memberships as membership
    where membership.group_id = post_group_id
      and membership.profile_id = caller_profile_id
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'post pinning is not allowed' using errcode = '42501';
  end if;
  update public.posts
  set pinned_at = case when p_pinned then coalesce(pinned_at, now()) else null end
  where id = p_post_id;
  return p_post_id;
end;
$$;

revoke all on function public.create_group_post(uuid, text, text, public.post_identity, uuid) from public;
revoke all on function public.update_group_post(uuid, text, text, uuid) from public;
revoke all on function public.delete_group_post(uuid) from public;
revoke all on function public.set_group_post_pinned(uuid, boolean) from public;
grant execute on function public.create_group_post(uuid, text, text, public.post_identity, uuid) to authenticated;
grant execute on function public.update_group_post(uuid, text, text, uuid) to authenticated;
grant execute on function public.delete_group_post(uuid) to authenticated;
grant execute on function public.set_group_post_pinned(uuid, boolean) to authenticated;

create function public.list_group_posts(
  p_group_id uuid,
  p_category_id uuid default null,
  p_cursor_published_at timestamptz default null,
  p_cursor_post_id uuid default null,
  p_limit integer default 20
)
returns table (
  post_id uuid, group_id uuid, category_id uuid, category_name text,
  title text, body text, author_identity public.post_identity,
  author_pub_id uuid, author_name text, author_avatar_path text, author_label text,
  is_pinned boolean, published_at timestamptz, edited_at timestamptz,
  is_author boolean, can_edit boolean, can_delete boolean, can_pin boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with pinned as (
    select post.*, 0 as section
    from public.posts as post
    where p_cursor_published_at is null and p_cursor_post_id is null
      and post.group_id = p_group_id and post.kind = 'group'
      and post.pinned_at is not null
      and (p_category_id is null or post.category_id = p_category_id)
  ), recent as (
    select post.*, 1 as section
    from public.posts as post
    where post.group_id = p_group_id and post.kind = 'group'
      and post.pinned_at is null
      and (p_category_id is null or post.category_id = p_category_id)
      and (
        p_cursor_published_at is null
        or (p_cursor_post_id is not null and (post.published_at, post.id) < (p_cursor_published_at, p_cursor_post_id))
      )
    order by post.published_at desc, post.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ), page as (
    select * from pinned union all select * from recent
  )
  select
    post.id, post.group_id, post.category_id, category.name,
    post.title, post.body, post.author_identity,
    access.author_pub_id, access.author_name, access.author_avatar_path, access.author_label,
    post.pinned_at is not null, post.published_at, post.edited_at,
    access.is_author, access.can_edit, access.can_delete, access.can_pin
  from page as post
  left join public.group_categories as category on category.id = post.category_id
  cross join lateral private.group_post_access(post.id) as access
  order by post.section, post.published_at desc, post.id desc;
$$;

create function public.get_group_post(p_post_id uuid)
returns table (
  post_id uuid, group_id uuid, category_id uuid, category_name text,
  title text, body text, author_identity public.post_identity,
  author_pub_id uuid, author_name text, author_avatar_path text, author_label text,
  is_pinned boolean, published_at timestamptz, edited_at timestamptz,
  is_author boolean, can_edit boolean, can_delete boolean, can_pin boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    post.id, post.group_id, post.category_id, category.name,
    post.title, post.body, post.author_identity,
    access.author_pub_id, access.author_name, access.author_avatar_path, access.author_label,
    post.pinned_at is not null, post.published_at, post.edited_at,
    access.is_author, access.can_edit, access.can_delete, access.can_pin
  from public.posts as post
  left join public.group_categories as category on category.id = post.category_id
  cross join lateral private.group_post_access(post.id) as access
  where post.id = p_post_id and post.kind = 'group';
$$;

create function public.search_group_posts(
  p_group_id uuid,
  p_query text,
  p_limit integer default 50
)
returns table (
  post_id uuid, group_id uuid, category_id uuid, category_name text,
  title text, body text, author_identity public.post_identity,
  author_pub_id uuid, author_name text, author_avatar_path text, author_label text,
  is_pinned boolean, published_at timestamptz, edited_at timestamptz,
  is_author boolean, can_edit boolean, can_delete boolean, can_pin boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    post.id, post.group_id, post.category_id, category.name,
    post.title, post.body, post.author_identity,
    access.author_pub_id, access.author_name, access.author_avatar_path, access.author_label,
    post.pinned_at is not null, post.published_at, post.edited_at,
    access.is_author, access.can_edit, access.can_delete, access.can_pin
  from public.posts as post
  left join public.group_categories as category on category.id = post.category_id
  cross join lateral private.group_post_access(post.id) as access
  where post.group_id = p_group_id and post.kind = 'group'
    and nullif(lower(regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g')), '') is not null
    and post.search_text like '%' || lower(regexp_replace(btrim(p_query), '[[:space:]]+', '', 'g')) || '%'
  order by post.published_at desc, post.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50);
$$;

revoke all on function public.list_group_posts(uuid, uuid, timestamptz, uuid, integer) from public;
revoke all on function public.get_group_post(uuid) from public;
revoke all on function public.search_group_posts(uuid, text, integer) from public;
grant execute on function public.list_group_posts(uuid, uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.get_group_post(uuid) to authenticated;
grant execute on function public.search_group_posts(uuid, text, integer) to authenticated;
