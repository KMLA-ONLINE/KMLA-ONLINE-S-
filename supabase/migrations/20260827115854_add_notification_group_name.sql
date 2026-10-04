-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION public.list_my_notifications(IN p_before_last_activity_at timestamp WITH time zone, IN p_before_id uuid, IN p_limit integer);

CREATE FUNCTION public.list_my_notifications (
  p_before_last_activity_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_before_id               uuid                     DEFAULT NULL::uuid,
  p_limit                   integer                  DEFAULT 20
)
  RETURNS TABLE (
    id                 uuid,
    kind               public.notification_kind,
    importance         public.notification_importance,
    category           public.notification_category,
    actor_identity     public.notification_actor_identity,
    actor_display_name text,
    actor_avatar_path  text,
    actor_count        integer,
    group_id           uuid,
    group_name         text,
    post_id            uuid,
    comment_id         uuid,
    target_profile_id  bigint,
    reservation_id     bigint,
    title              text,
    created_at         timestamp with time zone,
    last_activity_at   timestamp with time zone,
    read_at            timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 50 then
    raise exception 'notification page limit must be between 1 and 50' using errcode = '22023';
  end if;
  if (p_before_last_activity_at is null) <> (p_before_id is null) then
    raise exception 'notification cursor must be complete' using errcode = '22023';
  end if;

  -- 알림함 한 행은 "어디서 온 소식인가"를 말해야 한다. 특히 그룹 새 게시물 알림의 제목은
  -- 게시물 제목 그대로라서, 그룹 이름이 없으면 어느 그룹 글인지 알 방법이 없다.
  -- 이미 recipient 본인의 알림만 돌려주고 그 행이 group_id를 들고 있으므로 이름을 함께
  -- 내보내도 새로 드러나는 정보는 없다.
  --
  -- 그룹 삭제는 deleted_at을 세우는 soft delete라서 삭제된 그룹의 알림도 이름을 그대로
  -- 들고 온다. 그래야 "그룹이 영구 삭제되었습니다"가 어느 그룹인지 말할 수 있다. 이름이
  -- 비는 경우는 애초에 그룹과 무관한 알림뿐이다.
  return query
  select notification.id, notification.kind, notification.importance,
    notification.category, notification.actor_identity,
    notification.actor_display_name, notification.actor_avatar_path,
    notification.actor_count, notification.group_id, notification_group.name,
    notification.post_id,
    notification.comment_id, notification.target_profile_id,
    notification.reservation_id,
    notification.title, notification.created_at, notification.last_activity_at,
    notification.read_at
  from public.notifications as notification
  left join public.groups as notification_group
    on notification_group.id = notification.group_id
  where notification.recipient_profile_id = caller_profile_id
    and (
      p_before_last_activity_at is null
      or (notification.last_activity_at, notification.id)
        < (p_before_last_activity_at, p_before_id)
    )
  order by notification.last_activity_at desc, notification.id desc
  limit p_limit;
end;
$function$;

REVOKE ALL ON FUNCTION public.list_my_notifications(timestamp WITH time zone, uuid, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.list_my_notifications(timestamp WITH time zone, uuid, integer) TO authenticated;