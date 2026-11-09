SET local check_function_bodies = off;

CREATE TABLE "private"."post_reads" (
  "post_id"    uuid                     NOT NULL,
  "profile_id" bigint                   NOT NULL,
  "read_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "post_reads_pkey" PRIMARY KEY (post_id, profile_id)
);

ALTER TABLE "private"."post_reads"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_my_group_new_post_counts()
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
    and not exists (
      select 1 from private.post_reads as read
      where read.post_id = post.id and read.profile_id = caller_id
    )
  where membership.profile_id = caller_id
  group by membership.group_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_group_posts_visited (
  p_group_id   uuid,
  p_seen_until timestamp with time zone DEFAULT NULL::timestamp WITH time zone
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id bigint := private.current_profile_id();
  visited_at timestamptz;
begin
  if auth.uid() is null or caller_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  update public.group_memberships
  set posts_visited_at = greatest(
    posts_visited_at,
    least(coalesce(p_seen_until, statement_timestamp()), statement_timestamp())
  )
  where group_id = p_group_id and profile_id = caller_id
  returning posts_visited_at into visited_at;
  if not found then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  -- A read only matters while its post is newer than the watermark, so the rows it passed are dropped.
  delete from private.post_reads as read
  using public.posts as post
  where read.post_id = post.id
    and read.profile_id = caller_id
    and post.group_id = p_group_id
    and post.published_at <= visited_at;
end;
$function$;

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

  insert into private.post_reads (post_id, profile_id)
  select post.id, caller_id
  from public.posts as post
  join public.group_memberships as membership
    on membership.group_id = post.group_id
    and membership.profile_id = caller_id
  where post.id = p_post_id
    and post.kind = 'group'
    and post.published_at > membership.posts_visited_at
    and not exists (
      select 1 from private.post_authors as author
      where author.post_id = post.id and author.profile_id = caller_id
    )
  on conflict do nothing;
  return found;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."mark_post_read"(uuid) FROM PUBLIC, "anon", "service_role";

ALTER TABLE "private"."post_reads"
  ADD CONSTRAINT "post_reads_post_id_fkey" FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;

ALTER TABLE "private"."post_reads"
  ADD CONSTRAINT "post_reads_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE POLICY "post_reads_deny_client_access" ON "private"."post_reads"
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

GRANT EXECUTE ON FUNCTION "public"."mark_post_read"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."mark_post_read"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."mark_post_read"(uuid) TO "postgres";
