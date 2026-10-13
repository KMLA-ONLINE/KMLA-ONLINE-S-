SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.resolve_my_notification_destination (
  p_notification_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target public.notifications;
  destination text := '/noti';
  group_slug text;
  profile_pub_id text;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select notification.* into target
  from public.notifications as notification
  where notification.id = p_notification_id
    and notification.recipient_profile_id = private.current_profile_id()
  for update;
  if target.id is null then
    raise exception 'notification not found' using errcode = 'P0002';
  end if;

  if target.post_id is not null and private.can_read_post(target.post_id) then
    if target.group_id is not null then
      select group_record.slug into group_slug
      from public.groups as group_record
      where group_record.id = target.group_id;
      if group_slug is not null then
        destination := '/groups/' || group_slug || '/posts/' || target.post_id::text;
      end if;
    else
      select profile.pub_id into profile_pub_id
      from public.posts as post
      join public.profiles as profile on profile.id = post.timeline_profile_id
      where post.id = target.post_id;
      if profile_pub_id is not null then
        destination := '/profile/' || profile_pub_id || '/posts/' || target.post_id::text;
      end if;
    end if;
  elsif target.group_id is not null and private.is_group_member(target.group_id) then
    select group_record.slug into group_slug
    from public.groups as group_record
    where group_record.id = target.group_id;
    if group_slug is not null then destination := '/groups/' || group_slug; end if;
  elsif target.target_profile_id is not null then
    select profile.pub_id into profile_pub_id
    from public.profiles as profile
    where profile.id = target.target_profile_id
      and profile.status = 'accepted' and profile.deleted_at is null;
    if profile_pub_id is not null then destination := '/profile/' || profile_pub_id; end if;
  elsif target.kind = 'gongang_preempted' then
    destination := '/menu/gongang';
  end if;

  update public.notifications set read_at = coalesce(read_at, now()) where id = target.id;
  return destination;
end;
$function$;
