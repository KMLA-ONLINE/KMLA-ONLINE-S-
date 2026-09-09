-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP FUNCTION private.read_post_comments(IN p_comment_ids uuid[], IN p_caller_profile_id bigint, IN p_caller_role public.group_member_role);

DROP FUNCTION public.commit_group_post(p_post_id uuid, p_title text, p_body text, p_attachment_ids uuid[], p_publish boolean, p_category_id uuid);

DROP FUNCTION public.create_group_post(p_group_id uuid, p_title text, p_body text, p_author_identity public.post_identity, p_category_id uuid, p_publish boolean);

DROP FUNCTION public.create_post_comment(IN p_post_id uuid, IN p_body text, IN p_author_identity public.post_identity, IN p_parent_comment_id uuid, IN p_image_id uuid);

DROP FUNCTION public.get_group_post(IN p_post_id uuid);

DROP FUNCTION public.list_feed_posts(IN p_page_token uuid);

DROP FUNCTION public.list_group_posts(IN p_group_id uuid, IN p_category_id uuid, IN p_cursor_published_at timestamp
  WITH time zone, IN p_cursor_post_id uuid, IN p_cursor_is_pinned boolean, IN p_limit integer);

DROP FUNCTION public.list_post_comment_replies(IN p_root_comment_id uuid);

DROP FUNCTION public.list_post_comments(IN p_post_id uuid, IN p_cursor_created_at timestamp WITH time zone, IN p_cursor_comment_id uuid, IN p_limit integer);

DROP FUNCTION public.update_group_post(p_post_id uuid, p_title text, p_body text, p_category_id uuid);

DROP FUNCTION public.update_post_comment(IN p_comment_id uuid, IN p_body text, IN p_image_id uuid, IN p_remove_image boolean);

CREATE FUNCTION private.comment_mentions_json (
  p_comment_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ordinal', mention.ordinal,
        'pub_id', profile.pub_id,
        'name', profile.name,
        'avatar_path', profile.avatar_path
      )
      order by mention.ordinal
    ),
    '[]'::jsonb
  )
  from public.comment_mentions as mention
  left join public.profiles as profile on profile.id = mention.profile_id
    and profile.status = 'accepted' and profile.deleted_at is null
  where mention.comment_id = p_comment_id;
$function$;

REVOKE ALL ON FUNCTION private.comment_mentions_json(uuid) FROM PUBLIC;

CREATE FUNCTION private.emit_post_mention_notifications (
  p_post_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  post_record public.posts;
  actor_profile_id bigint := private.current_profile_id();
  actor_profile public.profiles;
  actor_identity public.notification_actor_identity;
  mention record;
begin
  if actor_profile_id is null then return; end if;
  select post.* into post_record from public.posts as post where post.id = p_post_id;
  if post_record.id is null or post_record.published_at is null
    or post_record.kind <> 'group' then
    return;
  end if;
  actor_identity := post_record.author_identity::text::public.notification_actor_identity;
  select profile.* into actor_profile
  from public.profiles as profile where profile.id = actor_profile_id;

  for mention in
    select target.profile_id from public.post_mentions as target
    where target.post_id = p_post_id
  loop
    perform private.emit_notification(
      'post-mention:' || p_post_id::text || ':' || mention.profile_id::text,
      mention.profile_id, 'post_mentioned', 'normal', 'content', actor_identity,
      actor_profile_id,
      case actor_identity
        when 'identified' then coalesce(actor_profile.name, '탈퇴한 사용자')
        else '운영진'
      end,
      case when actor_identity = 'identified' then actor_profile.avatar_path end,
      private.mention_notification_title(post_record.title, false),
      post_record.group_id, p_post_id
    );
  end loop;
end;
$function$;

REVOKE ALL ON FUNCTION private.emit_post_mention_notifications(uuid) FROM PUBLIC;

CREATE FUNCTION private.mention_notification_title (
  p_post_title text,
  p_in_comment boolean
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select '“'
    || case
      when char_length(btrim(coalesce(p_post_title, ''))) > 40
        then left(btrim(p_post_title), 39) || '…'
      else btrim(coalesce(p_post_title, ''))
    end
    || '” 게시물'
    || case when p_in_comment then '의 댓글' else '' end
    || '에서 회원님을 멘션했습니다.';
$function$;

REVOKE ALL ON FUNCTION private.mention_notification_title(text, boolean) FROM PUBLIC;

CREATE FUNCTION private.notify_comment_mention()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  comment_record public.post_comments;
  post_record public.posts;
  actor_profile_id bigint := private.current_profile_id();
  actor_profile public.profiles;
  actor_identity public.notification_actor_identity;
  direct_recipient_profile_id bigint;
begin
  if actor_profile_id is null then return new; end if;
  select comment.* into comment_record
  from public.post_comments as comment where comment.id = new.comment_id;
  if comment_record.id is null or comment_record.deleted_at is not null then
    return new;
  end if;
  select post.* into post_record
  from public.posts as post where post.id = comment_record.post_id;
  if post_record.id is null or post_record.published_at is null then return new; end if;

  -- 댓글·답글 알림이 이미 간 사람에게는 멘션 알림을 만들지 않는다(기능 명세 §14.9). 한 댓글로
  -- 알림 카드 두 장을 받는 일이 없어야 한다.
  if comment_record.parent_comment_id is not null then
    select author.profile_id into direct_recipient_profile_id
    from private.comment_authors as author
    where author.comment_id = comment_record.parent_comment_id;
  else
    select author.profile_id into direct_recipient_profile_id
    from private.post_authors as author
    where author.post_id = comment_record.post_id;
  end if;
  if new.profile_id is not distinct from direct_recipient_profile_id then
    return new;
  end if;

  actor_identity := comment_record.author_identity::text::public.notification_actor_identity;
  select profile.* into actor_profile
  from public.profiles as profile where profile.id = actor_profile_id;
  perform private.emit_notification(
    'comment-mention:' || new.comment_id::text || ':' || new.profile_id::text,
    new.profile_id, 'comment_mentioned', 'normal', 'content', actor_identity,
    actor_profile_id,
    case actor_identity
      when 'identified' then coalesce(actor_profile.name, '탈퇴한 사용자')
      else '운영진'
    end,
    case when actor_identity = 'identified' then actor_profile.avatar_path end,
    private.mention_notification_title(post_record.title, true),
    post_record.group_id, comment_record.post_id, new.comment_id
  );
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION private.notify_comment_mention() FROM PUBLIC;

CREATE FUNCTION private.notify_post_mention()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.emit_post_mention_notifications(new.post_id);
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION private.notify_post_mention() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.notify_post_published()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor_profile_id bigint := private.current_profile_id();
  actor_profile public.profiles;
  actor_identity public.notification_actor_identity := new.author_identity::text::public.notification_actor_identity;
  recipient record;
begin
  if new.published_at is null or (tg_op = 'UPDATE' and old.published_at is not null)
    or (new.kind = 'profile' and new.visibility = 'private') then
    return new;
  end if;
  if actor_profile_id is null then return new; end if;
  select profile.* into actor_profile
  from public.profiles as profile where profile.id = actor_profile_id;

  if new.kind = 'group' then
    for recipient in
      select membership.profile_id
      from public.group_memberships as membership
      where membership.group_id = new.group_id
        and membership.notification_level = 'all'
    loop
      perform private.emit_notification(
        'group-post:' || new.id::text || ':recipient:' || recipient.profile_id::text,
        recipient.profile_id, 'group_posted', 'low', 'group', actor_identity,
        actor_profile_id,
        case actor_identity
          when 'identified' then coalesce(actor_profile.name, '탈퇴한 사용자')
          when 'anonymous' then '익명'
          else '운영진'
        end,
        case when actor_identity = 'identified' then actor_profile.avatar_path end,
        new.title, new.group_id, new.id
      );
    end loop;
    -- 초안에 멘션을 넣고 나중에 게시하면(`publish_group_post`) 멘션 행은 이미 있고 새
    -- INSERT가 없어 트리거가 돌지 않는다. 게시되는 이 순간이 그 알림의 유일한 자리다.
    perform private.emit_post_mention_notifications(new.id);
  elsif new.timeline_profile_id <> actor_profile_id then
    perform private.emit_notification(
      'timeline-post:' || new.id::text,
      new.timeline_profile_id, 'timeline_posted', 'normal', 'timeline', 'identified',
      actor_profile_id, coalesce(actor_profile.name, '탈퇴한 사용자'), actor_profile.avatar_path,
      '내 타임라인에 새 게시물이 등록되었습니다.', null, new.id, null,
      new.timeline_profile_id
    );
  end if;
  return new;
end;
$function$;

CREATE FUNCTION private.parse_mention_ordinals (
  p_body text
)
  RETURNS smallint[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select coalesce(
    array_agg(distinct (found.match[1])::smallint order by (found.match[1])::smallint),
    array[]::smallint[]
  )
  from regexp_matches(
    coalesce(p_body, ''), '\[@[^\]]*\]\(m:([0-9]{1,2})\)', 'g'
  ) as found(match);
$function$;

REVOKE ALL ON FUNCTION private.parse_mention_ordinals(text) FROM PUBLIC;

CREATE FUNCTION private.post_mentions_json (
  p_post_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ordinal', mention.ordinal,
        'pub_id', profile.pub_id,
        'name', profile.name,
        'avatar_path', profile.avatar_path
      )
      order by mention.ordinal
    ),
    '[]'::jsonb
  )
  from public.post_mentions as mention
  left join public.profiles as profile on profile.id = mention.profile_id
    and profile.status = 'accepted' and profile.deleted_at is null
  where mention.post_id = p_post_id;
$function$;

REVOKE ALL ON FUNCTION private.post_mentions_json(uuid) FROM PUBLIC;

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
    anonymous_author_restriction_expires_at timestamp with time zone,
    mentions                                jsonb
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
    active_restriction.expires_at,
    -- tombstone은 본문을 내보내지 않으므로 그 본문에 걸려 있던 멘션도 내보내지 않는다.
    case
      when comment.deleted_at is null then private.comment_mentions_json(comment.id)
      else '[]'::jsonb
    end
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

CREATE FUNCTION private.sync_comment_mentions (
  p_comment_id      uuid,
  p_body            text,
  p_author_identity public.post_identity,
  p_mention_pub_ids text[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  post_record public.posts;
  ordinals smallint[] := private.parse_mention_ordinals(p_body);
  resolved_count integer;
begin
  delete from public.comment_mentions where comment_id = p_comment_id;
  if coalesce(array_length(ordinals, 1), 0) = 0 then
    return;
  end if;

  select post.* into post_record
  from public.posts as post
  join public.post_comments as comment on comment.post_id = post.id
  where comment.id = p_comment_id;
  -- 개인 게시물의 댓글에는 멘션을 두지 않는다(기능 명세 §8.14).
  if post_record.kind <> 'group' then
    raise exception 'mentions are only available in group posts' using errcode = '22023';
  end if;
  if p_author_identity = 'anonymous' then
    raise exception 'anonymous comments cannot mention members' using errcode = '42501';
  end if;
  if (select max(entry.ordinal) from unnest(ordinals) as entry(ordinal)) > 10 then
    raise exception 'a comment can mention at most 10 members' using errcode = '22023';
  end if;

  insert into public.comment_mentions (comment_id, ordinal, profile_id)
  select p_comment_id, entry.ordinal, profile.id
  from unnest(ordinals) as entry(ordinal)
  join public.profiles as profile
    on lower(profile.pub_id) = lower(btrim(coalesce(p_mention_pub_ids[entry.ordinal], '')))
    and profile.status = 'accepted'
    and profile.deleted_at is null
  join public.group_memberships as membership
    on membership.group_id = post_record.group_id
    and membership.profile_id = profile.id;
  get diagnostics resolved_count = row_count;

  if resolved_count <> array_length(ordinals, 1) then
    raise exception 'every mention must name a current group member' using errcode = '22023';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION private.sync_comment_mentions(uuid, text, public.post_identity, text[]) FROM PUBLIC;

CREATE FUNCTION private.sync_post_mentions (
  p_post_id         uuid,
  p_body            text,
  p_mention_pub_ids text[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  post_record public.posts;
  ordinals smallint[] := private.parse_mention_ordinals(p_body);
  resolved_count integer;
begin
  delete from public.post_mentions where post_id = p_post_id;
  if coalesce(array_length(ordinals, 1), 0) = 0 then
    return;
  end if;

  select post.* into post_record from public.posts as post where post.id = p_post_id;
  if post_record.kind <> 'group' then
    raise exception 'mentions are only available in group posts' using errcode = '22023';
  end if;
  -- 익명 뒤에서 특정인을 지목하지 못하게 막는다. 운영진 명의는 실제 작성자의 이름과 사진을
  -- 그대로 보여주므로(기능 명세 §8.6) 익명이 아니고, 여기서 막지 않는다.
  if post_record.author_identity = 'anonymous' then
    raise exception 'anonymous posts cannot mention members' using errcode = '42501';
  end if;
  if (select max(entry.ordinal) from unnest(ordinals) as entry(ordinal)) > 10 then
    raise exception 'a post can mention at most 10 members' using errcode = '22023';
  end if;

  insert into public.post_mentions (post_id, ordinal, profile_id)
  select p_post_id, entry.ordinal, profile.id
  from unnest(ordinals) as entry(ordinal)
  join public.profiles as profile
    on lower(profile.pub_id) = lower(btrim(coalesce(p_mention_pub_ids[entry.ordinal], '')))
    and profile.status = 'accepted'
    and profile.deleted_at is null
  join public.group_memberships as membership
    on membership.group_id = post_record.group_id
    and membership.profile_id = profile.id;
  get diagnostics resolved_count = row_count;

  -- 토큰 하나가 남으면 화면에는 멘션이 보이는데 아무도 불리지 않는다. 조용히 흘리지 않고
  -- 통째로 되돌린다.
  if resolved_count <> array_length(ordinals, 1) then
    raise exception 'every mention must name a current group member' using errcode = '22023';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION private.sync_post_mentions(uuid, text, text[]) FROM PUBLIC;

ALTER TYPE public.notification_kind ADD VALUE 'post_mentioned' AFTER 'gongang_preempted';

ALTER TYPE public.notification_kind ADD VALUE 'comment_mentioned' AFTER 'post_mentioned';
