-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION private.read_post_comments(IN p_comment_ids uuid[], IN p_caller_profile_id bigint, IN p_caller_role public.group_member_role);

DROP FUNCTION public.create_post_comment(IN p_post_id uuid, IN p_body text, IN p_author_identity public.post_identity, IN p_parent_comment_id uuid, IN p_image_id uuid);

DROP FUNCTION public.get_group_post(IN p_post_id uuid);

DROP FUNCTION public.list_group_posts(IN p_group_id uuid, IN p_category_id uuid, IN p_cursor_published_at timestamp
  WITH time zone, IN p_cursor_post_id uuid, IN p_cursor_is_pinned boolean, IN p_limit integer);

DROP FUNCTION public.list_my_notifications(IN p_before_last_activity_at timestamp WITH time zone, IN p_before_id uuid, IN p_limit integer);

DROP FUNCTION public.list_post_comment_replies(IN p_root_comment_id uuid);

DROP FUNCTION public.list_post_comments(IN p_post_id uuid, IN p_cursor_created_at timestamp WITH time zone, IN p_cursor_comment_id uuid, IN p_limit integer);

DROP FUNCTION public.update_post_comment(IN p_comment_id uuid, IN p_body text, IN p_image_id uuid, IN p_remove_image boolean);

CREATE FUNCTION private.assert_group_anonymous_activity_allowed (
  p_group_id   uuid,
  p_profile_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if private.group_anonymous_activity_restricted(p_group_id, p_profile_id) then
    raise exception 'anonymous activity is restricted'
      using errcode = '42501';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION private.assert_group_anonymous_activity_allowed(uuid, bigint) FROM PUBLIC;

CREATE FUNCTION private.group_anonymous_activity_restricted (
  p_group_id   uuid,
  p_profile_id bigint
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from private.group_anonymous_activity_restrictions as restriction
    where restriction.group_id = p_group_id
      and restriction.profile_id = p_profile_id
      and restriction.ended_at is null
      and restriction.expires_at > now()
  );
$function$;

REVOKE ALL ON FUNCTION private.group_anonymous_activity_restricted(uuid, bigint) FROM PUBLIC;

CREATE FUNCTION private.lock_group_anonymous_activity_target (
  p_group_id   uuid,
  p_profile_id bigint
)
  RETURNS void
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_group_id::text || ':' || p_profile_id::text, 0)
  );
$function$;

REVOKE ALL ON FUNCTION private.lock_group_anonymous_activity_target(uuid, bigint) FROM PUBLIC;

CREATE FUNCTION private.notify_group_anonymous_activity_restricted()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  notification_id uuid;
begin
  notification_id := private.emit_notification(
    'anonymous-activity-restricted:' || new.id::text,
    new.profile_id, 'anonymous_activity_restricted', 'high', 'moderation',
    'staff', new.restricted_by_profile_id, '운영진', null,
    '그룹 익명 활동이 제한되었습니다.', new.group_id
  );
  update public.notifications
  set detail = new.reason, restriction_expires_at = new.expires_at
  where id = notification_id;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION private.notify_group_anonymous_activity_restricted() FROM PUBLIC;

CREATE FUNCTION private.read_post_comments (
  p_comment_ids       uuid[],
  p_caller_profile_id bigint,
  p_caller_role       public.group_member_role
)
  RETURNS TABLE (
    comment_id                              uuid,
    post_id                                 uuid,
    parent_comment_id                       uuid,
    root_comment_id                         uuid,
    depth                                   smallint,
    body                                    text,
    author_identity                         public.post_identity,
    author_pub_id                           text,
    author_name                             text,
    author_avatar_path                      text,
    author_label                            text,
    created_at                              timestamp with time zone,
    edited_at                               timestamp with time zone,
    is_deleted                              boolean,
    is_effective_feed_bump                  boolean,
    is_author                               boolean,
    can_edit                                boolean,
    can_delete                              boolean,
    reply_count                             integer,
    reaction_count                          integer,
    top_reactions                           public.post_reaction[],
    my_reaction                             public.post_reaction,
    parent_author_label                     text,
    can_moderate_anonymous                  boolean,
    anonymous_author_restricted             boolean,
    anonymous_author_restriction_expires_at timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select
    comment.id,
    comment.post_id,
    comment.parent_comment_id,
    comment.root_comment_id,
    comment.depth,
    -- tombstone은 원문도 작성자도 내보내지 않는다.
    case when comment.deleted_at is null then comment.body else '' end,
    comment.author_identity,
    case
      when comment.deleted_at is null and comment.author_identity in ('identified', 'staff')
      then profile.pub_id
    end,
    case
      when comment.deleted_at is null and comment.author_identity in ('identified', 'staff')
      then profile.name
    end,
    case
      when comment.deleted_at is null and comment.author_identity in ('identified', 'staff')
      then profile.avatar_path
    end,
    case
      when comment.deleted_at is null
      then private.comment_author_label(
        comment.author_identity, comment.anon_alias_number, profile.name
      )
    end,
    comment.created_at,
    comment.edited_at,
    comment.deleted_at is not null,
    feed_bump.comment_id is not null,
    comment.deleted_at is null
      and feed_bump.comment_id is null
      and author.profile_id = p_caller_profile_id,
    comment.deleted_at is null
      and feed_bump.comment_id is null
      and author.profile_id = p_caller_profile_id,
    comment.deleted_at is null
      and feed_bump.comment_id is null
      and (
        author.profile_id = p_caller_profile_id
        or coalesce(p_caller_role in ('owner', 'admin'), false)
      ),
    case
      when comment.depth = 0 then (
        select count(*)::integer
        from public.post_comments as reply
        where reply.root_comment_id = comment.id
          and reply.depth > 0
          and reply.deleted_at is null
      )
      else 0
    end,
    -- 삭제된 댓글에는 반응을 붙일 수 없으므로 tombstone의 요약은 비운다. 지우기 전에 달려 있던
    -- 반응 행은 남아 있지만, 자국만 남은 자리에 남의 반응 수를 보여줄 이유가 없다.
    case when comment.deleted_at is null then summary.total else 0 end,
    case
      when comment.deleted_at is null then summary.top
      else array[]::public.post_reaction[]
    end,
    case when comment.deleted_at is null then mine.reaction end,
    -- 자기 본문과 달리 부모의 이름은 부모가 지워져도 내려보낸다(기능 명세 §9.2).
    case
      when parent.id is not null
      then private.comment_author_label(
        parent.author_identity, parent.anon_alias_number, parent_profile.name
      )
    end,
    comment.deleted_at is null
      and comment.author_identity = 'anonymous'
      and author.profile_id <> p_caller_profile_id
      and coalesce(p_caller_role in ('owner', 'admin'), false),
    active_restriction.expires_at is not null,
    active_restriction.expires_at
  from public.post_comments as comment
  join public.posts as comment_post on comment_post.id = comment.post_id
  join private.comment_authors as author on author.comment_id = comment.id
  left join private.feed_bump_events as feed_bump
    on feed_bump.comment_id = comment.id
  left join public.profiles as profile
    on (
      (comment.author_identity = 'identified' and profile.id = comment.display_author_profile_id)
      or (comment.author_identity = 'staff' and profile.id = author.profile_id)
    )
    and profile.status = 'accepted'
    and profile.deleted_at is null
  left join public.comment_reactions as mine
    on mine.comment_id = comment.id and mine.profile_id = p_caller_profile_id
  left join lateral (
    select restriction.expires_at
    from private.group_anonymous_activity_restrictions as restriction
    where restriction.group_id = comment_post.group_id
      and restriction.profile_id = author.profile_id
      and restriction.ended_at is null
      and restriction.expires_at > now()
    order by restriction.created_at desc, restriction.id desc
    limit 1
  ) as active_restriction on comment.deleted_at is null
    and comment.author_identity = 'anonymous'
    and author.profile_id <> p_caller_profile_id
    and coalesce(p_caller_role in ('owner', 'admin'), false)
  left join lateral (
    select
      coalesce(sum(tally.n)::integer, 0) as total,
      coalesce(
        array_agg(tally.reaction order by tally.n desc, tally.reaction)
          filter (where tally.rank <= 3),
        array[]::public.post_reaction[]
      ) as top
    from (
      select
        entry.reaction,
        count(*)::integer as n,
        row_number() over (order by count(*) desc, entry.reaction) as rank
      from public.comment_reactions as entry
      where entry.comment_id = comment.id
      group by entry.reaction
    ) as tally
  ) as summary on true
  left join public.post_comments as parent on parent.id = comment.parent_comment_id
  left join private.comment_authors as parent_author on parent_author.comment_id = parent.id
  left join public.profiles as parent_profile
    on (
      (parent.author_identity = 'identified' and parent_profile.id = parent.display_author_profile_id)
      or (parent.author_identity = 'staff' and parent_profile.id = parent_author.profile_id)
    )
    and parent_profile.status = 'accepted'
    and parent_profile.deleted_at is null
  where comment.id = any (p_comment_ids)
  order by comment.created_at, comment.id;
$function$;

REVOKE ALL ON FUNCTION private.read_post_comments(uuid[], bigint, public.group_member_role) FROM PUBLIC;

CREATE TABLE private.group_anonymous_activity_restrictions (
  id                       uuid                     DEFAULT gen_random_uuid() NOT NULL,
  group_id                 uuid                     NOT NULL,
  profile_id               bigint                   NOT NULL,
  reason                   text                     NOT NULL,
  created_at               timestamp with time zone DEFAULT now() NOT NULL,
  expires_at               timestamp with time zone NOT NULL,
  restricted_by_profile_id bigint,
  source_kind              text                     NOT NULL,
  source_post_id           uuid,
  source_comment_id        uuid,
  ended_at                 timestamp with time zone,
  cancelled_at             timestamp with time zone,
  cancelled_by_profile_id  bigint
);

ALTER TABLE private.group_anonymous_activity_restrictions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE private.group_anonymous_activity_restrictions
  ADD CONSTRAINT group_anonymous_activity_restrictions_pkey PRIMARY KEY (id);

ALTER TABLE private.group_anonymous_activity_restrictions
  ADD CONSTRAINT group_anonymous_restrictions_cancelled_by_fkey FOREIGN KEY (cancelled_by_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE private.group_anonymous_activity_restrictions
  ADD CONSTRAINT group_anonymous_restrictions_duration CHECK (expires_at > created_at AND expires_at <= (created_at + '180 days'::interval));

ALTER TABLE private.group_anonymous_activity_restrictions
  ADD CONSTRAINT group_anonymous_restrictions_end_shape
    CHECK
    (ended_at IS NULL AND cancelled_at IS NULL AND cancelled_by_profile_id IS NULL OR ended_at = expires_at AND cancelled_at IS NULL AND cancelled_by_profile_id IS NULL OR ended_at
    = cancelled_at AND cancelled_at IS NOT NULL);

ALTER TABLE private.group_anonymous_activity_restrictions
  ADD CONSTRAINT group_anonymous_restrictions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

ALTER TABLE private.group_anonymous_activity_restrictions
  ADD CONSTRAINT group_anonymous_restrictions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE private.group_anonymous_activity_restrictions
  ADD CONSTRAINT group_anonymous_restrictions_reason CHECK (reason = btrim(reason) AND char_length(reason) >= 5 AND char_length(reason) <= 300);

ALTER TABLE private.group_anonymous_activity_restrictions
  ADD CONSTRAINT group_anonymous_restrictions_restricted_by_fkey FOREIGN KEY (restricted_by_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE private.group_anonymous_activity_restrictions
  ADD CONSTRAINT group_anonymous_restrictions_source_comment_fkey FOREIGN KEY (source_comment_id) REFERENCES public.post_comments(id) ON DELETE SET NULL;

ALTER TABLE private.group_anonymous_activity_restrictions
  ADD CONSTRAINT group_anonymous_restrictions_source_kind CHECK (source_kind = ANY (ARRAY['post'::text, 'comment'::text]));

ALTER TABLE private.group_anonymous_activity_restrictions
  ADD CONSTRAINT group_anonymous_restrictions_source_post_fkey FOREIGN KEY (source_post_id) REFERENCES public.posts(id) ON DELETE SET NULL;

ALTER TABLE private.group_anonymous_activity_restrictions
  ADD CONSTRAINT group_anonymous_restrictions_source_shape CHECK (source_post_id IS NULL AND source_comment_id IS NULL OR source_kind = 'post'::text AND source_post_id IS
    NOT NULL AND source_comment_id IS NULL OR source_kind = 'comment'::text AND source_post_id IS NULL AND source_comment_id IS NOT NULL);

CREATE UNIQUE INDEX group_anonymous_restrictions_active_idx ON private.group_anonymous_activity_restrictions (group_id, profile_id)
  WHERE ended_at IS NULL;

CREATE INDEX group_anonymous_restrictions_profile_idx ON private.group_anonymous_activity_restrictions (profile_id, group_id, expires_at DESC);

CREATE TRIGGER group_anonymous_activity_restrictions_notify_created
  AFTER INSERT ON private.group_anonymous_activity_restrictions
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_group_anonymous_activity_restricted();

CREATE POLICY group_anonymous_restrictions_deny_client_access ON private.group_anonymous_activity_restrictions
  USING (false)
  WITH CHECK (false);

ALTER TYPE public.notification_kind ADD VALUE 'anonymous_activity_restricted' AFTER 'comment_moderated';
