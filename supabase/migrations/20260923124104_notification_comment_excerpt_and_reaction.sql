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
    id                     uuid,
    kind                   public.notification_kind,
    importance             public.notification_importance,
    category               public.notification_category,
    actor_identity         public.notification_actor_identity,
    actor_display_name     text,
    actor_avatar_path      text,
    actor_count            integer,
    group_id               uuid,
    group_name             text,
    post_id                uuid,
    comment_id             uuid,
    target_profile_id      bigint,
    reservation_id         bigint,
    title                  text,
    detail                 text,
    comment_excerpt        text,
    reaction               public.post_reaction,
    restriction_expires_at timestamp with time zone,
    created_at             timestamp with time zone,
    last_activity_at       timestamp with time zone,
    read_at                timestamp with time zone
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
  -- 그룹 삭제 알림만 그룹 이름을 제목에 싣는다. 그룹 행이 하드 삭제로 사라지면 여기에서
  -- 이름을 붙일 수 없기 때문이다(삭제 및 보존 정책 §5.2). 이름이 비는 경우는 그 알림과
  -- 애초에 그룹과 무관한 알림뿐이다.
  --
  -- 댓글·답글 알림은 그 댓글 본문을, 반응 알림은 표시된 사람(가장 최근 반응자)이 지금 남겨 둔
  -- 반응 종류를 함께 돌려준다(기능 명세 §14.3). 알림 행에 복사해 두지 않고 읽을 때 붙이는
  -- 이유는 댓글이 수정·삭제되거나 반응이 바뀐 뒤에도 옛 원문이 알림에 남지 않게 하려는 것이다.
  -- 본문은 수신자가 지금 그 게시물을 읽을 수 있을 때만 싣는다 -- 그룹을 나간 뒤에도 그 그룹의
  -- 댓글이 알림함으로 새어 나오면 안 된다. 제목은 여전히 `title`이며 Push에도 그것만 쓴다.
  return query
  select notification.id, notification.kind, notification.importance,
    notification.category, notification.actor_identity,
    notification.actor_display_name, notification.actor_avatar_path,
    notification.actor_count, notification.group_id, notification_group.name,
    notification.post_id,
    notification.comment_id, notification.target_profile_id,
    notification.reservation_id,
    notification.title, notification.detail,
    case when notification.kind in ('post_commented', 'comment_replied') then
      case when notification_comment.deleted_at is null
        and private.can_read_post(notification_comment.post_id)
        then nullif(left(btrim(notification_comment.body), 200), '')
      end
    end,
    case notification.kind
      when 'post_reacted' then (
        select reaction.reaction from public.post_reactions as reaction
        where reaction.post_id = notification.post_id
          and reaction.profile_id = notification.actor_profile_id
      )
      when 'comment_reacted' then (
        select reaction.reaction from public.comment_reactions as reaction
        where reaction.comment_id = notification.comment_id
          and reaction.profile_id = notification.actor_profile_id
      )
    end,
    notification.restriction_expires_at,
    notification.created_at, notification.last_activity_at,
    notification.read_at
  from public.notifications as notification
  left join public.groups as notification_group
    on notification_group.id = notification.group_id
  left join public.post_comments as notification_comment
    on notification_comment.id = notification.comment_id
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