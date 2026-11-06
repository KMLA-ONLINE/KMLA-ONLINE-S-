SET local check_function_bodies = off;

DROP INDEX "private"."notification_delivery_message_push_unique_idx";

DROP FUNCTION "public"."claim_notification_deliveries"(integer, integer);

ALTER TABLE "private"."notification_delivery_outbox"
  ADD COLUMN "message_event" text;

CREATE OR REPLACE FUNCTION private.create_feed_session (
  p_profile_id bigint
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  session_id uuid;
  epoch timestamptz := statement_timestamp();
  viewer_cohorts smallint[] := private.feed_profile_cohorts(p_profile_id);
  -- 후보는 순위 순서의 배열이다. 배열 번호가 곧 순위(priority)이고, 출처는 1부터 매긴 번호로 둔다.
  candidate_post_ids uuid[];
  candidate_rank_times timestamptz[];
  candidate_sources integer[];
  candidate_total integer;
  -- 출처별 후보: `source_items`에 출처 번호 순, 같은 출처 안에서는 순위 순으로 이어 붙인 순위 목록.
  -- `source_next`는 그 출처에서 아직 배치하지 않은 첫 칸, `source_last`는 마지막 칸이다.
  -- 출처별 페이지 제한과 연속 제한. 개인은 4개·2개, 그룹은 10개·3개다.
  source_page_limits integer[];
  source_run_limits integer[];
  source_items integer[];
  source_next integer[];
  source_last integer[];
  source_total integer;
  -- frontier는 아직 한 번도 살펴보지 않은 첫 순위다. 그보다 앞인데 남아 있는 후보는 제한에 걸려
  -- 밀린 것이고, 그런 후보가 있는 출처를 `deferred`에 둔다.
  frontier integer := 1;
  deferred integer[] := '{}'::integer[];
  page_counts integer[];
  placed integer[];
  placed_count integer := 0;
  last_source integer;
  consecutive_count integer := 0;
  chosen integer;
  chosen_source integer;
  item_source integer;
  head integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('feed-session:' || p_profile_id::text, 0)
  );

  delete from private.feed_sessions
  where profile_id = p_profile_id and expires_at <= epoch;

  select session.id into session_id
  from private.feed_sessions as session
  where session.profile_id = p_profile_id
    and session.expires_at > epoch
    and session.created_at >= epoch - interval '5 seconds'
  order by session.created_at desc, session.id desc
  limit 1;

  if session_id is not null then
    return session_id;
  end if;

  with excess as (
    select session.id
    from private.feed_sessions as session
    where session.profile_id = p_profile_id
      and session.expires_at > epoch
    order by session.created_at desc, session.id desc
    offset 7
  )
  delete from private.feed_sessions as session
  using excess
  where session.id = excess.id;

  session_id := gen_random_uuid();

  insert into private.feed_sessions (id, profile_id, feed_epoch, expires_at)
  values (session_id, p_profile_id, epoch, epoch + interval '24 hours');

  -- 접근 조건은 `can_access_feed_post()`를 집합 조건으로 옮긴 것이다. 후보마다 그 함수를 부르면
  -- security definer 호출 비용이 후보 수만큼 쌓인다. 두 조건이 같은 게시물을 고르는지는
  -- `integrated_feed.test.sql`이 확인한다. 아래의 "같은 종류 활동은 최신 하나" 조건은 접근이 아니라
  -- 피드 구성 규칙이라 그 함수에는 없다. 지난 활동도 직접 링크로는 열린다.
  --
  -- 생탐 판정에 쓰는 타임라인 주인의 관련 기수도 게시물마다 구하지 않고 주인마다 한 번만 구한다.
  -- 보는 사람에게 관련 기수가 없으면 생탐은 어차피 들어오지 않으므로 아무도 구하지 않는다.
  with timeline_cohorts as materialized (
    select timeline.profile_id, private.feed_profile_cohorts(timeline.profile_id) as cohorts
    from (
      select distinct post.timeline_profile_id as profile_id
      from public.posts as post
      where post.kind = 'profile'
        and post.timeline_profile_id is not null
        and post.published_at is not null
        and coalesce(cardinality(viewer_cohorts), 0) > 0
    ) as timeline
  ),
  candidates as (
    select
      post.id as post_id,
      post.published_at,
      -- 6시간이 지났고 `#업`도 없는 게시물은 `feed_rank_time()`이 게시 시각을 그대로 돌려준다.
      -- 후보 대부분이 그런 지난 글이라 호출을 건너뛴다(search_path를 고정한 함수라 인라인되지 않는다).
      case
        when post.published_at <= epoch - interval '6 hours' and bump.effective_at is null
          then post.published_at
        else private.feed_rank_time(
          post.published_at,
          bump.effective_at,
          epoch,
          coalesce(reaction.total, 0),
          coalesce(comment.total, 0),
          post.kind = 'profile' and author.profile_id <> post.timeline_profile_id,
          post.activity_kind is not null
        )
      end as rank_time,
      post.kind <> 'group' as is_profile,
      case post.kind
        when 'group' then post.group_id::text
        else author.profile_id::text
      end as source_id
    from public.posts as post
    join private.post_authors as author on author.post_id = post.id
    left join public.profiles as timeline
      on timeline.id = post.timeline_profile_id
      and timeline.status = 'accepted'
      and timeline.deleted_at is null
    left join public.profiles as viewer
      on viewer.id = p_profile_id
      and viewer.status = 'accepted'
      and viewer.deleted_at is null
    left join timeline_cohorts
      on timeline_cohorts.profile_id = post.timeline_profile_id
    left join lateral (
      select event.effective_at
      from private.feed_bump_events as event
      where event.post_id = post.id and event.effective_at <= epoch
      order by event.effective_at desc, event.id desc
      limit 1
    ) as bump on true
    left join lateral (
      select coalesce(sum(event.delta), 0)::integer as total
      from private.post_reaction_count_events as event
      where event.post_id = post.id and event.occurred_at <= epoch
    ) as reaction on post.published_at > epoch - interval '6 hours'
    left join lateral (
      select count(*)::integer as total
      from public.post_comments as entry
      join private.comment_authors as comment_author on comment_author.comment_id = entry.id
      where entry.post_id = post.id
        and entry.depth = 0
        and entry.deleted_at is null
        and entry.created_at <= epoch
        and btrim(entry.body) <> '#업'
        and comment_author.profile_id <> author.profile_id
    ) as comment on post.published_at > epoch - interval '6 hours'
    where post.published_at is not null
      and post.published_at <= epoch
      and (
        (
          post.kind = 'group'
          and post.group_id in (
            select membership.group_id
            from public.group_memberships as membership
            join public.groups as group_record on group_record.id = membership.group_id
            where membership.profile_id = p_profile_id
          )
        )
        or (
          post.kind = 'profile'
          and post.visibility = 'public'
          and timeline.id is not null
          and (
            author.profile_id = post.timeline_profile_id
            or (
              (viewer_cohorts && timeline_cohorts.cohorts)
              and (viewer.gender is null or timeline.gender is null or viewer.gender = timeline.gender)
            )
          )
          and (
            post.activity_kind is null
            or post.timeline_profile_id = p_profile_id
            or timeline.type = 'teacher'
            or (
              viewer.cohort = timeline.cohort
              and (viewer.gender is null or timeline.gender is null or viewer.gender = timeline.gender)
            )
          )
          -- 같은 사람의 같은 종류 활동은 피드에 가장 최근 것 하나만 올린다(기능 명세 §6.1). 사진을
          -- 여러 번 바꾸면 지난 사진이 피드를 채운다. 타임라인에는 모두 남는다. 최신 활동을 가렸어도 지난
          -- 활동이 대신 떠오르지 않게 가리기와 무관하게 더 새로운 활동이 있는지만 본다.
          and (
            post.activity_kind is null
            or not exists (
              select 1
              from public.posts as newer
              where newer.timeline_profile_id = post.timeline_profile_id
                and newer.activity_kind = post.activity_kind
                and newer.published_at <= epoch
                and (newer.published_at, newer.id) > (post.published_at, post.id)
            )
          )
        )
      )
  ),
  numbered as (
    select
      candidate.*,
      row_number() over (
        order by candidate.rank_time desc, candidate.published_at desc, candidate.post_id desc
      )::integer as priority,
      dense_rank() over (
        order by candidate.is_profile, candidate.source_id
      )::integer as source_number
    from candidates as candidate
  ),
  slotted as (
    select
      numbered.*,
      row_number() over (
        order by numbered.source_number, numbered.priority
      )::integer as slot
    from numbered
  ),
  sources as (
    select
      slotted.source_number,
      bool_or(slotted.is_profile) as is_profile,
      min(slotted.slot)::integer as first_slot,
      max(slotted.slot)::integer as last_slot
    from slotted
    group by slotted.source_number
  )
  select
    (select array_agg(slotted.post_id order by slotted.priority) from slotted),
    (select array_agg(slotted.rank_time order by slotted.priority) from slotted),
    (select array_agg(slotted.source_number order by slotted.priority) from slotted),
    (select array_agg(slotted.priority order by slotted.slot) from slotted),
    (select array_agg(case when sources.is_profile then 4 else 10 end order by sources.source_number) from sources),
    (select array_agg(case when sources.is_profile then 2 else 3 end order by sources.source_number) from sources),
    (select array_agg(sources.first_slot order by sources.source_number) from sources),
    (select array_agg(sources.last_slot order by sources.source_number) from sources)
  into
    candidate_post_ids,
    candidate_rank_times,
    candidate_sources,
    source_items,
    source_page_limits,
    source_run_limits,
    source_next,
    source_last;

  candidate_total := coalesce(cardinality(candidate_post_ids), 0);
  if candidate_total = 0 then
    return session_id;
  end if;

  source_total := cardinality(source_next);
  placed := pg_catalog.array_fill(0, array[candidate_total]);

  -- 출처 제한(FEED_ALGORITHM.md §5): 자리마다 남은 후보 중 두 제한을 모두 만족하는 가장 높은
  -- 순위를 고르고, 없으면 남은 것 중 가장 높은 순위를 고른다. 남은 후보를 매번 처음부터 훑지
  -- 않는다. 같은 출처의 후보는 제한 결과가 같으므로 밀린 출처마다 맨 앞 하나만 보면 되고,
  -- 그런 출처는 몇 개뿐이다. 거기서 고를 수 없을 때만 frontier를 민다. 고르는 순서는 같고 일은
  -- 후보 수에 비례한다.
  while placed_count < candidate_total loop
    if placed_count % 20 = 0 then
      page_counts := pg_catalog.array_fill(0, array[source_total]);
    end if;

    chosen := null;

    foreach item_source in array deferred loop
      if page_counts[item_source] < source_page_limits[item_source]
        and not (
          item_source = last_source
          and consecutive_count >= source_run_limits[item_source]
        ) then
        head := source_items[source_next[item_source]];
        if chosen is null or head < chosen then
          chosen := head;
          chosen_source := item_source;
        end if;
      end if;
    end loop;

    -- 밀린 출처가 하나도 통과하지 못했다. frontier의 후보는 그들보다 순위가 낮으므로 이제 본다.
    -- 밀린 출처의 후보는 그 출처가 지금 제한에 걸려 있다는 뜻이라 그대로 지나친다.
    while chosen is null and frontier <= candidate_total loop
      item_source := candidate_sources[frontier];
      if item_source <> all(deferred) then
        if page_counts[item_source] < source_page_limits[item_source]
          and not (
            item_source = last_source
            and consecutive_count >= source_run_limits[item_source]
          ) then
          chosen := frontier;
          chosen_source := item_source;
        else
          deferred := deferred || item_source;
        end if;
      end if;
      frontier := frontier + 1;
    end loop;

    if chosen is null then
      -- 제한을 만족하는 후보가 없다. 남은 것 중 가장 높은 순위로 채운다.
      foreach item_source in array deferred loop
        head := source_items[source_next[item_source]];
        if chosen is null or head < chosen then
          chosen := head;
          chosen_source := item_source;
        end if;
      end loop;
    end if;

    placed_count := placed_count + 1;
    placed[placed_count] := chosen;
    source_next[chosen_source] := source_next[chosen_source] + 1;
    if chosen_source = any(deferred)
      and (
        source_next[chosen_source] > source_last[chosen_source]
        or source_items[source_next[chosen_source]] >= frontier
      ) then
      deferred := pg_catalog.array_remove(deferred, chosen_source);
    end if;

    page_counts[chosen_source] := page_counts[chosen_source] + 1;
    if chosen_source = last_source then
      consecutive_count := consecutive_count + 1;
    else
      last_source := chosen_source;
      consecutive_count := 1;
    end if;
  end loop;

  insert into private.feed_session_posts (session_id, position, post_id, rank_time)
  select
    session_id,
    slot.position::integer,
    candidate_post_ids[slot.priority],
    candidate_rank_times[slot.priority]
  from unnest(placed) with ordinality as slot(priority, position);

  return session_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_message_deleted_push (
  p_message_ids uuid[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  insert into private.notification_delivery_outbox (
    message_id, message_event, recipient_profile_id, subscription_id, channel, available_at
  )
  -- 보내는 중인 Push보다 먼저 나가면 늦게 도착한 원래 카드가 고친 카드를 덮는다. 그 lease가 끝난 뒤로
  -- 미루고, 그때 원래 Push가 실제로 나갔는지 발송 직전 확인이 본다.
  select sent.message_id, 'deleted', sent.recipient_profile_id, sent.subscription_id, 'web_push',
    case when sent.status = 'leased' then sent.lease_expires_at else now() end
  from private.notification_delivery_outbox as sent
  join private.messages as message on message.id = sent.message_id
  join public.conversation_members as member
    on member.conversation_id = message.conversation_id
    and member.profile_id = sent.recipient_profile_id
    and member.left_at is null
  where sent.message_id = any(p_message_ids)
    and sent.message_event is null
    -- 디스패처가 가져가 보내는 중(`leased`)인 Push도 곧 카드가 된다. 빼면 지운 메시지가 그대로 뜬다.
    and sent.status in ('sent', 'leased')
    and message.deleted_at is not null
    and (member.last_read_sent_at, member.last_read_message_id) < (message.sent_at, message.id)
    and not exists (
      select 1
      from private.notification_delivery_outbox as newer
      join private.messages as newer_message on newer_message.id = newer.message_id
      where newer.subscription_id = sent.subscription_id
        and newer.message_event is null
        and newer.status = 'sent'
        and newer_message.conversation_id = message.conversation_id
        and (newer_message.sent_at, newer_message.id) > (message.sent_at, message.id)
    )
  on conflict do nothing;

  if found then
    perform private.wake_notification_dispatcher();
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.message_deleted_delivery_allowed (
  p_delivery private.notification_delivery_outbox
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from private.messages as message
    join private.web_push_subscriptions as subscription
      on subscription.id = p_delivery.subscription_id
      and subscription.profile_id = p_delivery.recipient_profile_id
      and subscription.gone_at is null
      and (subscription.expiration_time is null or subscription.expiration_time > now())
    join public.conversation_members as member
      on member.conversation_id = message.conversation_id
      and member.profile_id = p_delivery.recipient_profile_id
      and member.left_at is null
    where message.id = p_delivery.message_id
      and message.deleted_at is not null
      and (member.last_read_sent_at, member.last_read_message_id) < (message.sent_at, message.id)
      -- 예약할 때 보내는 중이던 원래 Push가 끝내 나가지 못했으면 고칠 카드가 없다.
      and exists (
        select 1
        from private.notification_delivery_outbox as original
        where original.message_id = p_delivery.message_id
          and original.subscription_id = p_delivery.subscription_id
          and original.message_event is null
          and original.status = 'sent'
      )
      and not exists (
        select 1
        from private.notification_delivery_outbox as newer
        join private.messages as newer_message on newer_message.id = newer.message_id
        where newer.subscription_id = p_delivery.subscription_id
          and newer.message_event is null
          and newer.status in ('pending', 'leased', 'sent')
          and newer_message.conversation_id = message.conversation_id
          and (newer_message.sent_at, newer_message.id) > (message.sent_at, message.id)
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.message_delivery_allowed (
  p_delivery private.notification_delivery_outbox
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from private.messages as message
    join private.web_push_subscriptions as subscription
      on subscription.id = p_delivery.subscription_id
      and subscription.profile_id = p_delivery.recipient_profile_id
      and subscription.gone_at is null
      and (subscription.expiration_time is null or subscription.expiration_time > now())
    join public.conversation_members as member
      on member.conversation_id = message.conversation_id
      and member.profile_id = p_delivery.recipient_profile_id
      and member.left_at is null
      and message.sent_at >= member.joined_at
    where message.id = p_delivery.message_id
      and message.deleted_at is null
      and private.member_wants_message_push(member, message)
      and (member.last_read_sent_at, member.last_read_message_id) < (message.sent_at, message.id)
      and (
        not exists (
          select 1
          from private.notification_delivery_outbox as newer
          join private.messages as newer_message on newer_message.id = newer.message_id
          where newer.subscription_id = p_delivery.subscription_id
            and newer.id <> p_delivery.id
            and newer.message_event is null
            and newer.status in ('pending', 'leased')
            and newer_message.conversation_id = message.conversation_id
            and (newer_message.sent_at, newer_message.id) > (message.sent_at, message.id)
        )
        or exists (
          select 1
          from private.notification_delivery_outbox as skipped
          join private.messages as skipped_message on skipped_message.id = skipped.message_id
          where skipped.subscription_id = p_delivery.subscription_id
            and skipped.status = 'suppressed'
            and skipped_message.conversation_id = message.conversation_id
            and skipped_message.deleted_at is null
            and skipped_message.sent_at <= now() - interval '10 seconds'
            and (member.last_read_sent_at, member.last_read_message_id)
              < (skipped_message.sent_at, skipped_message.id)
            and skipped_message.sent_at > coalesce(
              (
                select max(sent_message.sent_at)
                from private.notification_delivery_outbox as sent
                join private.messages as sent_message on sent_message.id = sent.message_id
                where sent.subscription_id = p_delivery.subscription_id
                  and sent.status = 'sent'
                  and sent_message.conversation_id = message.conversation_id
              ),
              '-infinity'
            )
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.message_push_content (
  p_message_id           uuid,
  p_recipient_profile_id bigint,
  p_keys                 jsonb
)
  RETURNS TABLE (
    conversation_id uuid,
    title           text,
    body            text
  )
  LANGUAGE sql
  STABLE
  STRICT
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select
    message.conversation_id,
    case conversation.type
      when 'group' then conversation.name
      else coalesce(sender.name, '알 수 없는 사용자')
    end,
    left(
      case
        when conversation.type = 'group'
          then coalesce(sender_nickname.nickname, sender.name, '알 수 없는 사용자') || ': '
        else ''
      end
      || case
        -- 삭제 Push가 카드를 고쳐 쓸 때 대신 보일 메시지가 없으면 이 문구로 덮는다(§11.5).
        when message.deleted_at is not null then '삭제된 메시지입니다.'
        when coalesce(preference.message_preview_hidden, false) then '새 메시지가 있습니다.'
        else coalesce(
          nullif(
            private.message_plain_text(
              private.decrypt_message_text(message.body_ciphertext, message.key_version, p_keys)
            ),
            ''
          ),
          -- 첨부만 있으면 종류로 쓰고 파일 이름은 넣지 않는다(기능 명세 §13.17).
          (
            select case attachment.kind
              when 'image' then '사진'
              when 'video' then '동영상'
              when 'gif' then 'GIF'
              else '파일'
            end
            from private.message_attachments as attachment
            where attachment.message_id = message.id
              and attachment.status = 'ready'
            order by attachment.position
            limit 1
          ),
          ''
        )
      end,
      240
    )
  from private.messages as message
  join public.conversations as conversation on conversation.id = message.conversation_id
  left join public.profiles as sender on sender.id = message.sender_id
  left join private.conversation_nicknames as sender_nickname
    on sender_nickname.conversation_id = message.conversation_id
    and sender_nickname.profile_id = message.sender_id
  left join public.notification_preferences as preference
    on preference.profile_id = p_recipient_profile_id
  where message.id = p_message_id;
$function$;

CREATE OR REPLACE FUNCTION private.notification_delivery_allowed (
  p_delivery private.notification_delivery_outbox
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  -- 메시지 Push는 발송 직전 확인이 따로 있다(메시지 기술 설계, 알림 기술 설계 §11.3).
  -- 정지 기간에는 정지 이메일 말고는 보내지 않는다. 정지 전에 쌓인 Push도 여기서 걸러진다.
  select case
    -- 정지 메일은 그 정지가 아직 유효할 때만 보낸다. 바로 해제했거나 만료된 뒤 재시도로 늦게 나가지 않게 한다.
    when p_delivery.suspension_id is not null then p_delivery.suspension_event = 'lifted'
      or exists (
        select 1
        from private.profile_suspensions as suspension
        where suspension.id = p_delivery.suspension_id
          and suspension.ended_at is null
          and (suspension.expires_at is null or suspension.expires_at > now())
      )
    when private.profile_suspended(p_delivery.recipient_profile_id) then false
    when p_delivery.message_event = 'deleted'
    then private.message_deleted_delivery_allowed(p_delivery)
    when p_delivery.message_id is not null
    then private.message_delivery_allowed(p_delivery)
    else p_delivery.channel = 'email'
    or exists (
      select 1
      from public.notifications as notification
      join private.web_push_subscriptions as subscription
        on subscription.id = p_delivery.subscription_id
      where notification.id = p_delivery.notification_id
        and subscription.profile_id = p_delivery.recipient_profile_id
        and subscription.gone_at is null
        and private.notification_push_allowed(
          notification, subscription.created_at, subscription.expiration_time
        )
        and (
          notification.category = 'moderation'
          or notification.kind in (
            'group_deleted', 'group_join_rejected',
            'account_approved', 'account_rejected', 'account_blocked', 'account_unblocked'
          )
          or (
            notification.post_id is not null
            and exists (
              select 1
              from public.posts as post
              where post.id = notification.post_id
                and (
                  (post.kind = 'group' and exists (
                    select 1 from public.group_memberships as membership
                    where membership.group_id = post.group_id
                      and membership.profile_id = p_delivery.recipient_profile_id
                  ))
                  or (post.kind = 'profile' and post.visibility = 'public')
                )
            )
          )
          or (
            notification.post_id is null
            and notification.group_id is not null
            and exists (
              select 1 from public.group_memberships as membership
              join public.groups as group_record on group_record.id = membership.group_id
              where membership.group_id = notification.group_id
                and membership.profile_id = p_delivery.recipient_profile_id
            )
          )
          or (notification.post_id is null and notification.group_id is null)
        )
    )
  end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_notification_deliveries (
  p_limit         integer DEFAULT 50,
  p_lease_seconds integer DEFAULT 120
)
  RETURNS TABLE (
    delivery_id     uuid,
    lease_id        uuid,
    channel         private.notification_delivery_channel,
    endpoint        text,
    p256dh          text,
    auth            text,
    recipient_email text,
    notification_id uuid,
    message_id      uuid,
    conversation_id uuid,
    importance      public.notification_importance,
    category        public.notification_category,
    grouping_key    uuid,
    title           text,
    body            text,
    tag             text,
    message_event   text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if p_limit not between 1 and 200 or p_lease_seconds not between 30 and 600 then
    raise exception 'invalid notification lease parameters' using errcode = '22023';
  end if;
  update private.notification_delivery_outbox as delivery
  set status = 'suppressed', completed_at = now(),
    lease_id = null, lease_expires_at = null,
    last_error_code = 'no_longer_deliverable'
  where delivery.channel = 'web_push'
    and (
      delivery.status = 'pending'
      or (delivery.status = 'leased' and delivery.lease_expires_at <= now())
    )
    and delivery.available_at <= now()
    and not private.notification_delivery_allowed(delivery);
  update private.notification_delivery_outbox as delivery
  set status = 'dead', completed_at = now(),
    lease_id = null, lease_expires_at = null,
    last_error_code = 'attempts_exhausted'
  where (
      delivery.status = 'pending'
      or (delivery.status = 'leased' and delivery.lease_expires_at <= now())
    )
    and delivery.available_at <= now()
    and delivery.attempt_count >= 10;

  return query
  with candidates as (
    select delivery.id
    from private.notification_delivery_outbox as delivery
    where (
        delivery.status = 'pending'
        or (delivery.status = 'leased' and delivery.lease_expires_at <= now())
      )
      and delivery.available_at <= now()
      and delivery.attempt_count < 10
    order by delivery.available_at, delivery.created_at, delivery.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update private.notification_delivery_outbox as delivery
    set status = 'leased', lease_id = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = delivery.attempt_count + 1
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  ), keys as (
    -- 메시지 본문은 이 배치에 메시지 Push가 있을 때만 키를 읽어 복호화한다.
    select case
      when exists (select 1 from claimed where claimed.message_id is not null)
        then private.message_keys()
    end as value
  )
  select claimed.id, claimed.lease_id, claimed.channel,
    subscription.endpoint, subscription.p256dh, subscription.auth,
    claimed.recipient_email, notification.id,
    claimed.message_id, message_content.conversation_id,
    notification.importance, notification.category,
    subscription.id,
    coalesce(
      message_content.title, suspension_content.title, push_content.title, notification.title
    ),
    case
      when claimed.message_id is not null then message_content.body
      when claimed.suspension_id is not null then suspension_content.body
      when claimed.channel = 'web_push' then push_content.body
      -- 메일은 계정 상태 알림에만 쓴다. 제목은 알림함 문장 그대로다.
      else case notification.kind
      when 'account_approved' then '가입이 승인되었습니다.'
      when 'account_rejected' then case
        when rejection_content.reason is not null
          then '사유: ' || rejection_content.reason || chr(10) || chr(10)
        else ''
      end || '학교 프로필 설정에서 정보를 고쳐 다시 제출해 주세요.'
      when 'account_blocked' then '가입이 차단되었습니다.'
      when 'account_unblocked' then '학교 프로필 설정에서 정보를 확인하고 다시 제출해 주세요.'
      else '새 알림이 있습니다.'
      end
    end,
    case
      when claimed.message_id is not null
        then 'message:' || message_content.conversation_id::text
      when claimed.suspension_id is not null
        then 'suspension:' || claimed.suspension_id::text || ':' || claimed.suspension_event
      when notification.importance = 'high'
        then 'notification:' || notification.id::text
      else 'notification-category:' || notification.category::text || ':' || subscription.id::text
    end,
    claimed.message_event
  from claimed
  left join private.web_push_subscriptions as subscription
    on subscription.id = claimed.subscription_id
  left join public.notifications as notification
    on notification.id = claimed.notification_id
  cross join keys
  -- 삭제 Push는 카드를 아직 안 읽은 그 대화의 가장 최근 메시지로 고쳐 쓴다. 없으면 지운 메시지 자체를
  -- 넘겨 `삭제된 메시지입니다.`로 덮는다. 새 메시지 Push와 같은 수신 설정(끄기·멘션만)을 따른다.
  left join lateral (
    select candidate.id
    from private.messages as deleted
    join public.conversation_members as member
      on member.conversation_id = deleted.conversation_id
      and member.profile_id = claimed.recipient_profile_id
    join private.messages as candidate
      on candidate.conversation_id = deleted.conversation_id
    where claimed.message_event = 'deleted'
      and deleted.id = claimed.message_id
      and candidate.deleted_at is null
      and candidate.system_kind is null
      and candidate.sender_id is distinct from claimed.recipient_profile_id
      and candidate.sent_at >= member.joined_at
      and (member.last_read_sent_at, member.last_read_message_id) < (candidate.sent_at, candidate.id)
      and private.member_wants_message_push(member, candidate)
    order by candidate.sent_at desc, candidate.id desc
    limit 1
  ) as replacement on true
  left join lateral private.message_push_content(
    coalesce(replacement.id, claimed.message_id), claimed.recipient_profile_id, keys.value
  ) as message_content on true
  left join lateral private.notification_push_content(notification.id) as push_content
    on claimed.channel = 'web_push'
  left join lateral (
    select
      case claimed.suspension_event
        when 'suspended' then '이용이 정지되었습니다.'
        else '이용 정지가 해제되었습니다.'
      end as title,
      case claimed.suspension_event
        when 'suspended' then
          '사유: ' || suspension.reason || chr(10) || '해제 예정: ' || coalesce(
            to_char(suspension.expires_at at time zone 'Asia/Seoul', 'YYYY"년" FMMM"월" FMDD"일" HH24:MI') || ' (한국 시간)',
            '무기한'
          )
        else '다시 KMLA Online을 이용할 수 있습니다.'
      end as body
    from private.profile_suspensions as suspension
    where suspension.id = claimed.suspension_id
  ) as suspension_content on true
  -- 반려 기록은 알림과 같은 트랜잭션에서 남으므로 알림 시각 이전의 가장 최근 기록이 그 반려다.
  -- 발송 전에 승인돼 기록이 지워졌으면 사유 없이 보낸다.
  left join lateral (
    select record.reason
    from private.application_rejections as record
    where notification.kind = 'account_rejected'
      and record.profile_id = notification.recipient_profile_id
      and record.rejected_at <= notification.created_at
    order by record.rejected_at desc, record.id desc
    limit 1
  ) as rejection_content on true;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."claim_notification_deliveries"(integer, integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.delete_messages (
  p_message_ids uuid[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  previous_suppression text;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if coalesce(cardinality(p_message_ids), 0) not between 1 and 100 then
    raise exception 'between 1 and 100 messages required'
      using errcode = '22023';
  end if;

  perform 1
  from private.messages as message
  where message.id = any(p_message_ids)
  for update;

  if exists (
    select 1
    from unnest(p_message_ids) as requested(id)
    left join private.messages as message on message.id = requested.id
    where message.sender_id is distinct from caller_profile_id
  ) then
    raise exception 'message sender required'
      using errcode = '42501';
  end if;

  -- 반응·고정 행을 지울 때마다 trigger가 메시지를 고치고 신호를 보내지 않도록 그동안 신호를 끈다.
  -- 마지막 메시지 갱신이 한 번만 신호를 보낸다. 운영 작업이 이미 꺼 두었다면 그 값으로 돌려놓는다.
  previous_suppression := current_setting('messaging.suppress_signals', true);
  perform set_config('messaging.suppress_signals', 'on', true);

  delete from private.message_reactions as entry
  where entry.message_id = any(p_message_ids);

  delete from private.message_pins as pin
  where pin.message_id = any(p_message_ids);

  perform set_config(
    'messaging.suppress_signals', coalesce(previous_suppression, 'off'), true
  );

  -- 첨부 object는 Storage 정리 작업이 `deleted` 행을 지우며 회수한다.
  update private.message_attachments as attachment
  set status = 'deleted'
  where attachment.message_id = any(p_message_ids)
    and attachment.status <> 'deleted';

  update private.messages as message
  set deleted_at = clock_timestamp(),
    body_ciphertext = null,
    key_version = null,
    mention_profile_ids = '{}',
    mentions_everyone = false
  where message.id = any(p_message_ids)
    and message.deleted_at is null;

  perform private.enqueue_message_deleted_push(p_message_ids);
end;
$function$;

ALTER TABLE "private"."notification_delivery_outbox"
  ADD CONSTRAINT "notification_delivery_outbox_message_event" CHECK (((message_event IS NULL) OR ((message_event = 'deleted'::text) AND (message_id IS NOT NULL))));

CREATE UNIQUE INDEX notification_delivery_message_deleted_unique_idx ON private.notification_delivery_outbox USING btree (message_id, subscription_id)
  WHERE (message_event = 'deleted'::text);

CREATE UNIQUE INDEX notification_delivery_message_push_unique_idx ON private.notification_delivery_outbox USING btree (message_id, subscription_id)
  WHERE ((message_id IS NOT NULL) AND (message_event IS NULL));

CREATE INDEX posts_profile_activity_recent_idx ON public.posts USING btree (timeline_profile_id, activity_kind, published_at DESC, id DESC)
  WHERE (activity_kind IS NOT NULL);

REVOKE ALL ON FUNCTION "private"."enqueue_message_deleted_push"(uuid[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."message_deleted_delivery_allowed"(private.notification_delivery_outbox) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."claim_notification_deliveries"(integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_notification_deliveries"(integer, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_notification_deliveries"(integer, integer) TO "service_role";
