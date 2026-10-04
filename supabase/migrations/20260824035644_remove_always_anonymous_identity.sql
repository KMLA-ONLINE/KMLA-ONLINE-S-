-- Identity policy now controls whether anonymous posting is available, not whether
-- every member and interaction must be anonymous. Recreate the enum because
-- PostgreSQL cannot remove an enum label in place.
do $$
declare
  function_definitions text[];
  function_definition text;
begin
  select array_agg(pg_get_functiondef(function.oid) order by function.oid)
  into function_definitions
  from pg_catalog.pg_proc as function
  join pg_catalog.pg_namespace as namespace on namespace.oid = function.pronamespace
  where (namespace.nspname, function.proname) in (
    ('private', 'comment_post_context'),
    ('public', 'create_group'),
    ('public', 'discover_groups'),
    ('public', 'get_group_invite_preview'),
    ('public', 'update_group_settings')
  );

  drop function private.comment_post_context(uuid, bigint);
  drop function public.create_group(
    public.group_kind, text, text, text, public.group_join_policy,
    public.group_identity_policy, public.group_posting_policy
  );
  drop function public.discover_groups(text, boolean, smallint, bigint, uuid, integer);
  drop function public.get_group_invite_preview(text);
  drop function public.update_group_settings(
    uuid, text, text, public.group_join_policy, public.group_identity_policy,
    public.group_posting_policy
  );

  alter type public.group_identity_policy rename to group_identity_policy_old;
  create type public.group_identity_policy as enum ('identified', 'optional_anonymous');
  alter table public.groups
    alter column identity_policy type public.group_identity_policy
    using (
      case identity_policy::text
        when 'always_anonymous' then 'optional_anonymous'
        else identity_policy::text
      end
    )::public.group_identity_policy;
  drop type public.group_identity_policy_old;

  foreach function_definition in array function_definitions loop
    execute function_definition;
  end loop;
end;
$$;

revoke all on function private.comment_post_context(uuid, bigint)
  from public, anon, authenticated;
revoke all on function public.create_group(
  public.group_kind, text, text, text, public.group_join_policy,
  public.group_identity_policy, public.group_posting_policy
) from public, anon;
revoke all on function public.discover_groups(text, boolean, smallint, bigint, uuid, integer)
  from public, anon;
revoke all on function public.get_group_invite_preview(text) from public, anon;
revoke all on function public.update_group_settings(
  uuid, text, text, public.group_join_policy, public.group_identity_policy,
  public.group_posting_policy
) from public, anon;
grant execute on function public.create_group(
  public.group_kind, text, text, text, public.group_join_policy,
  public.group_identity_policy, public.group_posting_policy
) to authenticated;
grant execute on function public.discover_groups(text, boolean, smallint, bigint, uuid, integer)
  to authenticated;
grant execute on function public.get_group_invite_preview(text) to authenticated;
grant execute on function public.update_group_settings(
  uuid, text, text, public.group_join_policy, public.group_identity_policy,
  public.group_posting_policy
) to authenticated;

create or replace function public.list_group_members(
  p_group_id uuid,
  p_query text default '',
  p_after_role public.group_member_role default null,
  p_after_joined_at timestamptz default null,
  p_after_membership_id uuid default null,
  p_limit integer default 30
)
returns table (
  membership_id uuid, pub_id text, name text, cohort smallint, avatar_path text,
  role public.group_member_role, joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  query_text text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'member page limit must be between 1 and 100' using errcode = '22023';
  end if;
  if (p_after_role is null) <> (p_after_joined_at is null)
    or (p_after_role is null) <> (p_after_membership_id is null) then
    raise exception 'member cursor must be complete' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
  ) then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select membership.id, profile.pub_id, profile.name, profile.cohort,
    profile.avatar_path, membership.role, membership.joined_at
  from public.group_memberships as membership
  join public.profiles as profile on profile.id = membership.profile_id
  where membership.group_id = p_group_id
    and (
      query_text = ''
      or profile.cohort::text like '%' || query_text || '%'
      or profile.name ilike '%' || query_text || '%'
    )
    and (
      p_after_role is null
      or (membership.role, membership.joined_at, membership.id)
        > (p_after_role, p_after_joined_at, p_after_membership_id)
    )
  order by membership.role, membership.joined_at, membership.id
  limit p_limit;
end;
$$;

create or replace function public.list_group_join_requests(p_group_id uuid)
returns table (
  request_id uuid, pub_id text, name text, cohort smallint, avatar_path text,
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null or not exists (
    select 1 from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
      and caller_membership.role in ('owner', 'admin')
  ) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  return query
  select join_request.id, profile.pub_id, profile.name, profile.cohort,
    profile.avatar_path, join_request.requested_at
  from public.group_join_requests as join_request
  join public.profiles as profile on profile.id = join_request.profile_id
  where join_request.group_id = p_group_id
  order by join_request.requested_at, join_request.id;
end;
$$;

create or replace function public.update_group_settings(
  p_group_id uuid,
  p_name text,
  p_description text,
  p_join_policy public.group_join_policy,
  p_identity_policy public.group_identity_policy,
  p_posting_policy public.group_posting_policy
)
returns table (
  name text, description text, join_policy public.group_join_policy,
  identity_policy public.group_identity_policy,
  posting_policy public.group_posting_policy, updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  current_group public.groups%rowtype;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group administrator required' using errcode = '42501';
  end if;
  select group_record.* into current_group
  from public.groups as group_record
  where group_record.id = p_group_id
  for update;
  if not exists (
    select 1 from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
      and caller_membership.role in ('owner', 'admin')
  ) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;
  if current_group.join_policy <> 'invite_only' and p_join_policy = 'invite_only' then
    raise exception 'public groups cannot become private' using errcode = '55000';
  end if;
  if current_group.join_policy = 'request' and p_join_policy <> 'request' and exists (
    select 1 from public.group_join_requests as join_request
    where join_request.group_id = p_group_id
  ) then
    raise exception 'pending join requests must be resolved first' using errcode = '55000';
  end if;

  return query
  update public.groups as group_record
  set name = btrim(p_name), description = btrim(coalesce(p_description, '')),
    join_policy = p_join_policy, identity_policy = p_identity_policy,
    posting_policy = p_posting_policy
  where group_record.id = p_group_id
  returning group_record.name, group_record.description, group_record.join_policy,
    group_record.identity_policy, group_record.posting_policy, group_record.updated_at;
end;
$$;

create or replace function public.create_group_post(
  p_group_id uuid,
  p_title text,
  p_body text,
  p_author_identity public.post_identity,
  p_category_id uuid default null,
  p_publish boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
  created_post_id uuid;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = p_group_id
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if group_posting_policy = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'group posting is restricted to staff' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' and group_identity_policy = 'identified' then
    raise exception 'anonymous posting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'staff' and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 100 then
    raise exception 'title must contain between 1 and 100 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(p_body, '')) > 20000 then
    raise exception 'body must contain between 0 and 20000 characters' using errcode = '22023';
  end if;
  if coalesce(p_publish, true) and nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'published post requires a body or ready attachment' using errcode = '22023';
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
    'group', coalesce(p_body, ''), p_group_id, btrim(p_title), p_category_id,
    p_author_identity, case when p_author_identity = 'identified' then caller_profile_id end,
    case when coalesce(p_publish, true) then now() end
  ) returning id into created_post_id;
  insert into private.post_authors (post_id, profile_id)
  values (created_post_id, caller_profile_id);
  return created_post_id;
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
  target_group_id uuid;
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.group_id into target_group_id
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null;
  if target_group_id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can publish this post' using errcode = '42501';
  end if;

  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = target_group_id and group_data.deleted_at is null
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
    and post.group_id = target_group_id and post.deleted_at is null
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can publish this post' using errcode = '42501';
  end if;
  if post_record.published_at is not null then
    return p_post_id;
  end if;
  if group_posting_policy = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'group posting is restricted to staff' using errcode = '42501';
  end if;
  if post_record.author_identity = 'anonymous'
    and group_identity_policy = 'identified' then
    raise exception 'anonymous posting is not allowed' using errcode = '42501';
  end if;
  if post_record.author_identity = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
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
  target_group_id uuid;
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.group_id into target_group_id
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null;
  if target_group_id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can commit this post' using errcode = '42501';
  end if;

  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = target_group_id and group_data.deleted_at is null
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
    and post.group_id = target_group_id and post.deleted_at is null
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can commit this post' using errcode = '42501';
  end if;
  if coalesce(p_publish, false) and post_record.published_at is not null then
    raise exception 'post is already published' using errcode = '55000';
  end if;
  if coalesce(p_publish, false) then
    if group_posting_policy = 'staff'
      and member_role not in ('owner', 'admin', 'manager') then
      raise exception 'group posting is restricted to staff' using errcode = '42501';
    end if;
    if post_record.author_identity = 'anonymous'
      and group_identity_policy = 'identified' then
      raise exception 'anonymous posting is not allowed' using errcode = '42501';
    end if;
    if post_record.author_identity = 'staff'
      and member_role not in ('owner', 'admin', 'manager') then
      raise exception 'staff identity is not allowed' using errcode = '42501';
    end if;
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

create or replace function public.create_post_comment(
  p_post_id uuid,
  p_body text,
  p_author_identity public.post_identity,
  p_parent_comment_id uuid default null,
  p_image_id uuid default null
)
returns table (
  comment_id uuid, post_id uuid, parent_comment_id uuid, root_comment_id uuid,
  depth smallint, body text, author_identity public.post_identity,
  author_pub_id text, author_name text, author_avatar_path text, author_label text,
  created_at timestamptz, edited_at timestamptz, is_deleted boolean,
  is_author boolean, can_edit boolean, can_delete boolean, reply_count integer,
  reaction_count integer, top_reactions public.post_reaction[],
  my_reaction public.post_reaction, parent_author_label text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_profile_id bigint := private.current_profile_id();
  context record;
  parent_record public.post_comments;
  image_record public.comment_images;
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
  perform 1
  from public.posts as post
  join public.groups as group_data on group_data.id = post.group_id
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where post.id = p_post_id and post.kind = 'group'
  for share of group_data, membership;
  context := private.comment_post_context(p_post_id, caller_profile_id);
  if context.post_kind is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if not context.is_visible then
    raise exception 'post is not accessible' using errcode = '42501';
  end if;
  if context.post_kind = 'profile' then
    if p_author_identity <> 'identified' then
      raise exception 'profile post comments must be identified' using errcode = '42501';
    end if;
  else
    if p_author_identity = 'anonymous' and context.identity_policy = 'identified' then
      raise exception 'anonymous commenting is not allowed' using errcode = '42501';
    end if;
    if p_author_identity = 'staff'
      and context.caller_role not in ('owner', 'admin', 'manager') then
      raise exception 'staff identity is not allowed' using errcode = '42501';
    end if;
  end if;
  if char_length(trimmed_body) > 5000 then
    raise exception 'comment must contain between 1 and 5000 characters' using errcode = '22023';
  end if;
  if trimmed_body = '' and p_image_id is null then
    raise exception 'comment requires a body or finalized image' using errcode = '22023';
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
  if p_image_id is not null then
    select image.* into image_record
    from public.comment_images as image
    where image.id = p_image_id
    for update;
    if image_record.id is null or image_record.post_id <> p_post_id
      or image_record.status <> 'finalized' or image_record.comment_id is not null
      or not private.is_comment_image_uploader(p_image_id) then
      raise exception 'finalized comment image is not claimable' using errcode = '42501';
    end if;
  end if;
  if p_author_identity = 'anonymous' then
    select author.profile_id into post_author_profile_id
    from private.post_authors as author
    where author.post_id = p_post_id;
    if context.post_author_identity = 'anonymous'
      and post_author_profile_id = caller_profile_id then
      new_alias := 0;
    else
      select alias.alias_number into new_alias
      from private.post_anonymous_aliases as alias
      where alias.post_id = p_post_id and alias.profile_id = caller_profile_id;
      if new_alias is null then
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
    p_author_identity, case when p_author_identity = 'identified' then caller_profile_id end,
    new_alias
  );
  insert into private.comment_authors (comment_id, profile_id)
  values (new_comment_id, caller_profile_id);
  if p_image_id is not null then
    update public.comment_images
    set comment_id = new_comment_id, status = 'ready', ready_at = now()
    where id = p_image_id;
  end if;
  return query
  select entry.*
  from private.read_post_comments(
    array[new_comment_id], caller_profile_id, context.caller_role
  ) as entry;
end;
$$;

-- Reactions are ordinary identified activity. The private context helper now only
-- validates that the caller can access the target post.
delete from public.post_reactions where is_anonymous;
delete from public.comment_reactions where is_anonymous;
alter table public.post_reactions drop column is_anonymous;
alter table public.comment_reactions drop column is_anonymous;

drop function private.reaction_context(uuid, bigint);
create function private.reaction_context(p_post_id uuid, p_caller_profile_id bigint)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  post_record public.posts;
  group_record public.groups;
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
    return;
  end if;
  select group_data.* into group_record
  from public.groups as group_data
  where group_data.id = post_record.group_id;
  if group_record.id is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.group_memberships as membership
    where membership.group_id = group_record.id
      and membership.profile_id = p_caller_profile_id
  ) then
    raise exception 'group membership required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.reaction_context(uuid, bigint)
  from public, anon, authenticated;

create or replace function public.set_post_reaction(
  p_post_id uuid, p_reaction public.post_reaction
)
returns table (
  reaction_count integer, top_reactions public.post_reaction[],
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
  insert into public.post_reactions as target (post_id, profile_id, reaction)
  values (p_post_id, caller_profile_id, p_reaction)
  on conflict (post_id, profile_id) do update
  set reaction = excluded.reaction, created_at = now()
  where target.reaction is distinct from excluded.reaction;
  return query select * from private.post_reaction_summary(p_post_id, caller_profile_id);
end;
$$;

create or replace function public.set_comment_reaction(
  p_comment_id uuid, p_reaction public.post_reaction
)
returns table (
  reaction_count integer, top_reactions public.post_reaction[],
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
  insert into public.comment_reactions as target (comment_id, profile_id, reaction)
  values (p_comment_id, caller_profile_id, p_reaction)
  on conflict (comment_id, profile_id) do update
  set reaction = excluded.reaction, created_at = now()
  where target.reaction is distinct from excluded.reaction;
  return query select * from private.comment_reaction_summary(p_comment_id, caller_profile_id);
end;
$$;

drop function public.list_post_reactors(uuid);
create function public.list_post_reactors(p_post_id uuid)
returns table (
  reaction public.post_reaction, reactor_pub_id text, reactor_name text,
  reactor_avatar_path text, reacted_at timestamptz
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
  select entry.reaction, profile.pub_id, profile.name, profile.avatar_path,
    entry.created_at
  from public.post_reactions as entry
  left join public.profiles as profile on profile.id = entry.profile_id
    and profile.status = 'accepted' and profile.deleted_at is null
  where entry.post_id = p_post_id
  order by entry.created_at desc;
end;
$$;
revoke all on function public.list_post_reactors(uuid) from public, anon;
grant execute on function public.list_post_reactors(uuid) to authenticated;

drop function public.list_comment_reactors(uuid);
create function public.list_comment_reactors(p_comment_id uuid)
returns table (
  reaction public.post_reaction, reactor_pub_id text, reactor_name text,
  reactor_avatar_path text, reacted_at timestamptz
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
  select entry.reaction, profile.pub_id, profile.name, profile.avatar_path,
    entry.created_at
  from public.comment_reactions as entry
  left join public.profiles as profile on profile.id = entry.profile_id
    and profile.status = 'accepted' and profile.deleted_at is null
  where entry.comment_id = p_comment_id
  order by entry.created_at desc;
end;
$$;
revoke all on function public.list_comment_reactors(uuid) from public, anon;
grant execute on function public.list_comment_reactors(uuid) to authenticated;

revoke all on function public.create_group_post(
  uuid, text, text, public.post_identity, uuid, boolean
) from public, anon;
revoke all on function public.publish_group_post(uuid) from public, anon;
revoke all on function public.commit_group_post(uuid, text, text, uuid[], boolean, uuid)
  from public, anon;
revoke all on function public.create_post_comment(
  uuid, text, public.post_identity, uuid, uuid
) from public, anon;
revoke all on function public.set_post_reaction(uuid, public.post_reaction)
  from public, anon;
revoke all on function public.set_comment_reaction(uuid, public.post_reaction)
  from public, anon;
grant execute on function public.create_group_post(
  uuid, text, text, public.post_identity, uuid, boolean
) to authenticated;
grant execute on function public.publish_group_post(uuid) to authenticated;
grant execute on function public.commit_group_post(uuid, text, text, uuid[], boolean, uuid)
  to authenticated;
grant execute on function public.create_post_comment(
  uuid, text, public.post_identity, uuid, uuid
) to authenticated;
grant execute on function public.set_post_reaction(uuid, public.post_reaction)
  to authenticated;
grant execute on function public.set_comment_reaction(uuid, public.post_reaction)
  to authenticated;
