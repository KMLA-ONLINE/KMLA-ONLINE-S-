SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.list_post_previews (
  p_post_ids uuid[]
)
  RETURNS TABLE (
    post_id            uuid,
    kind               public.post_kind,
    group_name         text,
    title              text,
    body               text,
    author_label       text,
    author_avatar_path text,
    image_path         text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_post_ids), 0) > 100 then
    raise exception 'too many posts' using errcode = '22023';
  end if;

  return query
  select
    post.id,
    post.kind,
    grp.name,
    post.title,
    left(post.body, 300),
    case post.author_identity
      when 'identified' then profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    case when post.author_identity in ('identified', 'staff') then profile.avatar_path end,
    cover.path
  from public.posts as post
  join private.post_authors as author on author.post_id = post.id
  left join public.groups as grp on grp.id = post.group_id
  left join public.profiles as profile
    on (
      (post.author_identity = 'identified' and profile.id = post.display_author_profile_id)
      or (post.author_identity = 'staff' and profile.id = author.profile_id)
    )
    and profile.status = 'accepted'
    and profile.deleted_at is null
  left join lateral (
    select coalesce(attachment.thumbnail_path, attachment.object_path) as path
    from public.post_attachments as attachment
    where attachment.post_id = post.id
      and attachment.status = 'ready'
      and attachment.mime_type like 'image/%'
    order by attachment.position
    limit 1
  ) as cover on true
  where post.id = any(p_post_ids)
    and post.published_at is not null
    and private.can_read_post(post.id);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_post_previews"(uuid[]) FROM PUBLIC, "anon", "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_post_previews"(uuid[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_post_previews"(uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_post_previews"(uuid[]) TO "postgres";
