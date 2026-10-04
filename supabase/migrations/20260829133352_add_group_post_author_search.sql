-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.search_group_posts (
  p_group_id uuid,
  p_query    text,
  p_limit    integer DEFAULT 50
)
  RETURNS TABLE (
    post_id            uuid,
    group_id           uuid,
    category_id        uuid,
    category_name      text,
    title              text,
    body               text,
    author_identity    public.post_identity,
    author_pub_id      text,
    author_name        text,
    author_avatar_path text,
    author_label       text,
    is_pinned          boolean,
    published_at       timestamp with time zone,
    edited_at          timestamp with time zone,
    is_author          boolean,
    can_edit           boolean,
    can_delete         boolean,
    can_pin            boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
    case when post.author_identity in ('identified', 'staff') then profile.pub_id end,
    case when post.author_identity in ('identified', 'staff') then profile.name end,
    case when post.author_identity in ('identified', 'staff') then profile.avatar_path end,
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
    on (
      (post.author_identity = 'identified' and profile.id = post.display_author_profile_id)
      or (post.author_identity = 'staff' and profile.id = author.profile_id)
    )
    and profile.status = 'accepted'
    and profile.deleted_at is null
  where post.group_id = p_group_id and post.kind = 'group'
    and post.published_at is not null and post.deleted_at is null
    and nullif(normalized_query, '') is not null
    and (
      post.search_text like '%' || normalized_query || '%'
      or profile.search_name like '%' || normalized_query || '%'
    )
  order by post.published_at desc, post.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50);
end;
$function$;