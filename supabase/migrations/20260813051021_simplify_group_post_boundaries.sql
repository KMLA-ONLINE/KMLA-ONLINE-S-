-- Browser writes cross these boundaries only through explicitly authorized RPCs.
drop policy "groups_insert_accepted_creator" on public.groups;
revoke insert on public.groups from authenticated;

drop policy "group_categories_insert_staff" on public.group_categories;
drop policy "group_categories_update_staff" on public.group_categories;
drop policy "group_categories_delete_staff" on public.group_categories;
revoke insert, update, delete on public.group_categories from authenticated;

drop policy "posts_update_pin_staff" on public.posts;
revoke update on public.posts from authenticated;

-- The table remains inaccessible even if a future role receives schema usage;
-- definer functions owned by the migration role bypass this deny-all policy.
create policy "post_authors_deny_client_access"
on private.post_authors
for all
to public
using (false)
with check (false);

create or replace function public.create_group(
  p_kind public.group_kind,
  p_name text,
  p_description text default '',
  p_slug text default null,
  p_join_policy public.group_join_policy default null,
  p_identity_policy public.group_identity_policy default 'optional_anonymous',
  p_posting_policy public.group_posting_policy default 'members'
)
returns table (group_id uuid, slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile public.profiles;
  chosen_policy public.group_join_policy;
  chosen_slug text;
  created_group_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if caller_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_kind = 'official'
    and (caller_profile.role <> 'admin' or caller_profile.type = 'teacher') then
    raise exception 'official group creation is not allowed' using errcode = '42501';
  end if;

  chosen_policy := coalesce(
    p_join_policy,
    case
      when p_kind = 'official' then 'open'::public.group_join_policy
      else 'invite_only'::public.group_join_policy
    end
  );

  if chosen_policy = 'invite_only' and nullif(btrim(p_slug), '') is not null then
    raise exception 'invite-only groups cannot use a custom slug' using errcode = '22023';
  end if;

  if chosen_policy = 'invite_only' or nullif(btrim(p_slug), '') is null then
    chosen_slug := 'g-' || encode(extensions.gen_random_bytes(10), 'hex');
  else
    chosen_slug := lower(btrim(p_slug));
  end if;

  insert into public.groups (
    id, slug, slug_is_custom, kind, name, description, join_policy,
    identity_policy, posting_policy, created_by
  ) values (
    created_group_id,
    chosen_slug,
    chosen_policy <> 'invite_only' and nullif(btrim(p_slug), '') is not null,
    p_kind,
    btrim(p_name),
    btrim(coalesce(p_description, '')),
    chosen_policy,
    p_identity_policy,
    p_posting_policy,
    caller_profile.id
  );

  return query select created_group_id, chosen_slug;
end;
$$;

create or replace function public.create_group_category(
  p_group_id uuid,
  p_name text,
  p_position integer default null
)
returns public.group_categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint;
  created_category public.group_categories;
  chosen_position integer;
begin
  caller_profile_id := private.current_profile_id();
  if auth.uid() is null or caller_profile_id is null or not exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = caller_profile_id
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  select coalesce(
    p_position,
    coalesce(max(category.position) + 1, 0)
  )
  into chosen_position
  from public.group_categories as category
  where category.group_id = p_group_id;

  insert into public.group_categories (group_id, name, position)
  values (p_group_id, btrim(p_name), chosen_position)
  returning * into created_category;
  return created_category;
end;
$$;

create or replace function public.update_group_category(
  p_category_id uuid,
  p_name text,
  p_position integer
)
returns public.group_categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  category_record public.group_categories;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;

  select category.* into category_record
  from public.group_categories as category
  where category.id = p_category_id
  for update;

  if category_record.id is null then
    raise exception 'category not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.group_memberships as membership
    where membership.group_id = category_record.group_id
      and membership.profile_id = caller_profile_id
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;

  update public.group_categories
  set name = btrim(p_name), position = p_position
  where id = p_category_id
  returning * into category_record;
  return category_record;
end;
$$;

create or replace function public.delete_group_category(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  category_record public.group_categories;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;

  select category.* into category_record
  from public.group_categories as category
  where category.id = p_category_id
  for update;

  if category_record.id is null then
    raise exception 'category not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.group_memberships as membership
    where membership.group_id = category_record.group_id
      and membership.profile_id = caller_profile_id
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;

  delete from public.group_categories where id = p_category_id;
end;
$$;

create function public.move_group_category(
  p_category_id uuid,
  p_direction smallint
)
returns setof public.group_categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  category_record public.group_categories;
  target_ordinality bigint;
  adjacent_ordinality bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;
  if p_direction not in (-1, 1) then
    raise exception 'direction must be -1 or 1' using errcode = '22023';
  end if;

  select category.* into category_record
  from public.group_categories as category
  where category.id = p_category_id;
  if category_record.id is null then
    raise exception 'category not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.group_memberships as membership
    where membership.group_id = category_record.group_id
      and membership.profile_id = caller_profile_id
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;

  perform 1
  from public.groups as group_record
  where group_record.id = category_record.group_id
  for update;
  perform 1
  from public.group_categories as category
  where category.group_id = category_record.group_id
  order by category.position, category.id
  for update;

  select ordered.ordinality
  into target_ordinality
  from (
    select category.id, row_number() over (order by category.position, category.id) as ordinality
    from public.group_categories as category
    where category.group_id = category_record.group_id
  ) as ordered
  where ordered.id = p_category_id;
  adjacent_ordinality := target_ordinality + p_direction;

  if adjacent_ordinality between 1 and (
    select count(*) from public.group_categories
    where group_id = category_record.group_id
  ) then
    with ordered as (
      select
        category.id,
        row_number() over (order by category.position, category.id) as ordinality
      from public.group_categories as category
      where category.group_id = category_record.group_id
    )
    update public.group_categories as category
    set position = case
      when ordered.ordinality = target_ordinality then adjacent_ordinality - 1
      when ordered.ordinality = adjacent_ordinality then target_ordinality - 1
      else ordered.ordinality - 1
    end
    from ordered
    where category.id = ordered.id;
  end if;

  return query
  select category.*
  from public.group_categories as category
  where category.group_id = category_record.group_id
  order by category.position, category.id;
end;
$$;

create or replace function public.set_group_post_pinned(p_post_id uuid, p_pinned boolean)
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
  where post.id = p_post_id
    and post.kind = 'group'
    and post.published_at is not null
    and post.deleted_at is null
  for update;

  if post_record.id is null or not exists (
    select 1 from public.group_memberships as membership
    where membership.group_id = post_record.group_id
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

-- No browser role can update posts directly. The trigger permits only the
-- one-way publication transition used by the author-checked publication RPC.
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
    or new.visibility is distinct from old.visibility
    or new.body_format_version is distinct from old.body_format_version
    or new.created_at is distinct from old.created_at
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

create or replace function public.publish_group_post(p_post_id uuid)
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

  if post_record.id is null or not exists (
    select 1 from private.post_authors as author
    where author.post_id = p_post_id and author.profile_id = caller_profile_id
  ) then
    raise exception 'only the author can publish this post' using errcode = '42501';
  end if;
  if post_record.published_at is not null then
    return p_post_id;
  end if;
  if exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status = 'pending'
  ) then
    raise exception 'pending attachments must be finalized or deleted' using errcode = '55000';
  end if;
  if nullif(btrim(post_record.body), '') is null and not exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status = 'ready'
  ) then
    raise exception 'published post requires a body or ready attachment' using errcode = '22023';
  end if;

  update public.posts set published_at = now() where id = p_post_id;
  return p_post_id;
end;
$$;

create or replace function public.list_group_posts(
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
  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id;
  if caller_role is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  with pinned as (
    select post.*, 0 as section
    from public.posts as post
    where p_cursor_published_at is null and p_cursor_post_id is null
      and post.group_id = p_group_id and post.kind = 'group'
      and post.published_at is not null and post.deleted_at is null
      and post.pinned_at is not null
      and (p_category_id is null or post.category_id = p_category_id)
  ), recent as (
    select post.*, 1 as section
    from public.posts as post
    where post.group_id = p_group_id and post.kind = 'group'
      and post.published_at is not null and post.deleted_at is null
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
    case when post.author_identity = 'identified' then profile.pub_id end,
    case when post.author_identity = 'identified' then profile.name end,
    case when post.author_identity = 'identified' then profile.avatar_path end,
    case post.author_identity
      when 'identified' then profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    post.pinned_at is not null, post.published_at, post.edited_at,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id or caller_role in ('owner', 'admin'),
    caller_role in ('owner', 'admin', 'manager')
  from page as post
  join private.post_authors as author on author.post_id = post.id
  left join public.group_categories as category on category.id = post.category_id
  left join public.profiles as profile
    on post.author_identity = 'identified'
    and profile.id = post.display_author_profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  order by post.section, post.published_at desc, post.id desc;
end;
$$;

create or replace function public.get_group_post(p_post_id uuid)
returns table (
  post_id uuid, group_id uuid, category_id uuid, category_name text,
  title text, body text, author_identity public.post_identity,
  author_pub_id uuid, author_name text, author_avatar_path text, author_label text,
  is_pinned boolean, published_at timestamptz, edited_at timestamptz,
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
    case when post.author_identity = 'identified' then profile.pub_id end,
    case when post.author_identity = 'identified' then profile.name end,
    case when post.author_identity = 'identified' then profile.avatar_path end,
    case post.author_identity
      when 'identified' then profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    post.pinned_at is not null, post.published_at, post.edited_at,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id or caller_role in ('owner', 'admin'),
    caller_role in ('owner', 'admin', 'manager')
  from public.posts as post
  join private.post_authors as author on author.post_id = post.id
  left join public.group_categories as category on category.id = post.category_id
  left join public.profiles as profile
    on post.author_identity = 'identified'
    and profile.id = post.display_author_profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  where post.id = p_post_id and post.kind = 'group'
    and post.published_at is not null and post.deleted_at is null;
end;
$$;

create or replace function public.search_group_posts(
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
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  caller_role public.group_member_role;
  normalized_query text := lower(
    regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g')
  );
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
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
    case when post.author_identity = 'identified' then profile.pub_id end,
    case when post.author_identity = 'identified' then profile.name end,
    case when post.author_identity = 'identified' then profile.avatar_path end,
    case post.author_identity
      when 'identified' then profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    post.pinned_at is not null, post.published_at, post.edited_at,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id or caller_role in ('owner', 'admin'),
    caller_role in ('owner', 'admin', 'manager')
  from public.posts as post
  join private.post_authors as author on author.post_id = post.id
  left join public.group_categories as category on category.id = post.category_id
  left join public.profiles as profile
    on post.author_identity = 'identified'
    and profile.id = post.display_author_profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  where post.group_id = p_group_id and post.kind = 'group'
    and post.published_at is not null and post.deleted_at is null
    and nullif(normalized_query, '') is not null
    and post.search_text like '%' || normalized_query || '%'
  order by post.published_at desc, post.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50);
end;
$$;

drop function private.group_post_access(uuid);

revoke all on function public.create_group(
  public.group_kind, text, text, text, public.group_join_policy,
  public.group_identity_policy, public.group_posting_policy
) from public, anon;
revoke all on function public.create_group_category(uuid, text, integer) from public, anon;
revoke all on function public.update_group_category(uuid, text, integer) from public, anon;
revoke all on function public.delete_group_category(uuid) from public, anon;
revoke all on function public.move_group_category(uuid, smallint) from public, anon;
revoke all on function public.set_group_post_pinned(uuid, boolean) from public, anon;
revoke all on function public.publish_group_post(uuid) from public, anon;
revoke all on function public.list_group_posts(uuid, uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function public.get_group_post(uuid) from public, anon;
revoke all on function public.search_group_posts(uuid, text, integer) from public, anon;

grant execute on function public.move_group_category(uuid, smallint) to authenticated;
