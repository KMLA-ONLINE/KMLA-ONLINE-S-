SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.record_post_read (
  p_post_id    uuid,
  p_profile_id bigint
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  insert into private.post_reads (post_id, profile_id)
  select post.id, p_profile_id
  from public.posts as post
  join public.group_memberships as membership
    on membership.group_id = post.group_id
    and membership.profile_id = p_profile_id
  where post.id = p_post_id
    and post.kind = 'group'
    and post.published_at > membership.posts_visited_at
    and not exists (
      select 1 from private.post_authors as author
      where author.post_id = post.id and author.profile_id = p_profile_id
    )
  on conflict do nothing;
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_post_opened (
  p_post_id uuid
)
  RETURNS TABLE (
    counted_as_new     boolean,
    notifications_read integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id bigint := private.current_profile_id();
  dropped boolean;
  changed integer;
begin
  if auth.uid() is null or caller_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  dropped := private.record_post_read(p_post_id, caller_id);

  update public.notifications
  set read_at = now()
  where recipient_profile_id = caller_id
    and post_id = p_post_id
    and read_at is null
    and kind in (
      'group_posted', 'timeline_posted', 'post_commented', 'comment_replied',
      'post_reacted', 'comment_reacted', 'post_mentioned', 'comment_mentioned'
    );
  get diagnostics changed = row_count;

  return query select dropped, changed;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."mark_post_opened"(uuid) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.mark_post_read (
  p_post_id uuid
)
  RETURNS boolean
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

  return private.record_post_read(p_post_id, caller_id);
end;
$function$;

REVOKE ALL ON FUNCTION "private"."record_post_read"(uuid, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."mark_post_opened"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."mark_post_opened"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."mark_post_opened"(uuid) TO "postgres";
