-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.get_my_group_new_post_counts()
  RETURNS TABLE (
    group_id       uuid,
    new_post_count bigint
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  return query
  select membership.group_id, count(post.id)
  from public.group_memberships as membership
  left join public.posts as post
    on post.group_id = membership.group_id
    and post.kind = 'group'
    and post.published_at > membership.posts_visited_at
    and not exists (
      select 1 from private.post_authors as author
      where author.post_id = post.id and author.profile_id = caller_id
    )
  where membership.profile_id = caller_id
  group by membership.group_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_my_group_new_post_counts() FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.get_my_group_new_post_counts() TO authenticated;

CREATE FUNCTION public.mark_group_posts_visited (
  p_group_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  update public.group_memberships
  set posts_visited_at = greatest(posts_visited_at, statement_timestamp())
  where group_id = p_group_id and profile_id = caller_id;
  if not found then
    raise exception 'group membership required' using errcode = '42501';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.mark_group_posts_visited(uuid) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.mark_group_posts_visited(uuid) TO authenticated;

ALTER TABLE public.group_memberships
  -- Existing memberships start at deployment time; new memberships at joining time (§7.19).
  ADD COLUMN posts_visited_at timestamp with time zone DEFAULT now() NOT NULL;
