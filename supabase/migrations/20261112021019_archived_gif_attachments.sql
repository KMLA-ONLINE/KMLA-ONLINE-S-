SET local check_function_bodies = off;

DROP POLICY "post_attachments_storage_insert_pending_author" ON "storage"."objects";

DROP POLICY "post_attachments_storage_select_reader" ON "storage"."objects";

DROP VIEW "private"."referenced_storage_objects";

DROP FUNCTION "public"."list_conversation_attachments"(uuid, boolean, timestamp WITH time zone, uuid, integer);

DROP FUNCTION "public"."list_post_attachments"(uuid);

DROP FUNCTION "public"."prepare_message_attachments"(uuid, uuid, jsonb);

DROP FUNCTION "public"."prepare_post_attachment"(uuid, text, text, bigint, integer, integer, text);

ALTER TABLE "private"."message_attachments"
  ADD COLUMN "gif_path" text;

ALTER TABLE "public"."post_attachments"
  ADD COLUMN "gif_path" text;

CREATE OR REPLACE FUNCTION private.apply_post_commit (
  p_post_id        uuid,
  p_body           text,
  p_attachment_ids uuid[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  attachment_count integer := cardinality(coalesce(p_attachment_ids, '{}'::uuid[]));
  removed_object_count integer;
begin
  if char_length(coalesce(p_body, '')) > 20000 then
    raise exception 'body must contain between 0 and 20000 characters' using errcode = '22023';
  end if;
  if attachment_count > 30
    or attachment_count <> (
      select count(distinct attachment_id)
      from unnest(coalesce(p_attachment_ids, '{}'::uuid[])) as attachment_id
    ) then
    raise exception 'attachment order must contain at most 30 unique ids' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_attachment_ids, '{}'::uuid[])) as requested(id)
    where not exists (
      select 1 from public.post_attachments as attachment
      where attachment.id = requested.id
        and attachment.post_id = p_post_id
        and attachment.status <> 'deleted'
    )
  ) then
    raise exception 'attachment does not belong to this post' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.post_attachments as attachment
    left join storage.objects as object
      on object.bucket_id = attachment.storage_bucket
      and object.name = attachment.object_path
    where attachment.id = any(coalesce(p_attachment_ids, '{}'::uuid[]))
      and attachment.status = 'pending'
      and (
        object.id is null
        or object.owner_id is distinct from auth.uid()::text
        or nullif(object.metadata ->> 'size', '')::bigint is distinct from attachment.size_bytes
        or object.metadata ->> 'mimetype' is distinct from attachment.mime_type
        or (
          lower(attachment.mime_type) like 'image/%'
          and attachment.size_bytes > 8388608
        )
      )
  ) then
    raise exception 'uploaded attachment metadata does not match' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null and attachment_count = 0 then
    raise exception 'post requires a body or ready attachment' using errcode = '22023';
  end if;

  -- 편집에서 뺀 첨부도 단독 삭제와 같은 수명주기를 따른다. tombstone 행이 순서를 보존해도
  -- object는 더 이상 읽히지 않으므로, 원본과 축소본을 먼저 큐에 넣고 워커를 깨운다.
  with removed as (
    update public.post_attachments
    set status = 'deleted', deleted_at = now()
    where post_id = p_post_id
      and status <> 'deleted'
      and not (id = any(coalesce(p_attachment_ids, '{}'::uuid[])))
    returning storage_bucket, object_path, thumbnail_path, gif_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select removed.storage_bucket, path.object_path, 'post_attachment'
  from removed
  cross join lateral (
    values (removed.object_path), (removed.thumbnail_path), (removed.gif_path)
  ) as path(object_path)
  where path.object_path is not null
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics removed_object_count = row_count;
  if removed_object_count > 0 then
    perform private.invoke_storage_cleanup(p_quiet => true);
  end if;

  -- 순서를 음수로 밀어 두고 다시 매긴다. `(post_id, position)` unique 제약을 중간 상태에서
  -- 밟지 않기 위한 것이다.
  update public.post_attachments
  set position = -position - 1
  where post_id = p_post_id and status <> 'deleted';

  update public.post_attachments as attachment
  set position = requested.ordinality - 1,
    status = 'ready',
    ready_at = coalesce(attachment.ready_at, now())
  from unnest(coalesce(p_attachment_ids, '{}'::uuid[]))
    with ordinality as requested(id, ordinality)
  where attachment.id = requested.id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.assert_uploaded_gif (
  p_bucket      text,
  p_object_path text
)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  uploaded storage.objects;
begin
  select object.* into uploaded
  from storage.objects as object
  where object.bucket_id = p_bucket
    and object.name = p_object_path;
  if uploaded.id is null then
    raise exception 'uploaded GIF not found' using errcode = 'P0002';
  end if;
  if uploaded.owner_id is distinct from auth.uid()::text then
    raise exception 'uploaded GIF owner does not match' using errcode = '42501';
  end if;
  if uploaded.metadata ->> 'mimetype' is distinct from 'image/gif'
    or (
      case
        when uploaded.metadata ->> 'size' ~ '^[0-9]+$'
        then (uploaded.metadata ->> 'size')::bigint not between 1 and 31457280
        else true
      end
    ) then
    raise exception 'uploaded GIF does not match' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.can_read_message_object (
  p_object_path text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from private.message_attachments as attachment
    join private.messages as message on message.id = attachment.message_id
    join public.conversation_members as period
      on period.conversation_id = message.conversation_id
      and period.profile_id = private.current_profile_id()
      and message.sent_at >= period.joined_at
      and (period.left_at is null or message.sent_at < period.left_at)
    where (
        (
          attachment.status = 'ready'
          and p_object_path in (attachment.object_path, attachment.thumbnail_path, attachment.gif_path)
        )
        -- 보존 기간이 지난 첨부는 첫 프레임만 남는다.
        or (attachment.status = 'expired' and p_object_path = attachment.thumbnail_path)
      )
      and message.deleted_at is null
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_upload_message_object (
  p_object_path text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from private.message_attachments as attachment
    where p_object_path in (attachment.object_path, attachment.thumbnail_path, attachment.gif_path)
      and attachment.status = 'pending'
      and attachment.uploader_id = private.current_profile_id()
  );
$function$;

CREATE OR REPLACE FUNCTION private.claim_message_attachments (
  p_caller_profile_id bigint,
  p_conversation_id   uuid,
  p_message_id        uuid
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  pending private.message_attachments;
  uploaded storage.objects;
  ready_count integer;
begin
  for pending in
    select attachment.*
    from private.message_attachments as attachment
    where attachment.message_id = p_message_id
      and attachment.status = 'pending'
    for update
  loop
    if pending.conversation_id <> p_conversation_id
      or pending.uploader_id is distinct from p_caller_profile_id then
      raise exception 'attachment belongs to another message'
        using errcode = '42501';
    end if;

    select object.*
    into uploaded
    from storage.objects as object
    where object.bucket_id = 'message-attachments'
      and object.name = pending.object_path;

    if uploaded.id is null then
      raise exception 'uploaded attachment not found'
        using errcode = 'P0002';
    end if;
    if uploaded.owner_id is distinct from auth.uid()::text then
      raise exception 'uploaded attachment owner does not match'
        using errcode = '42501';
    end if;
    if nullif(uploaded.metadata ->> 'size', '')::bigint is distinct from pending.size_bytes
      or (pending.kind = 'image' and uploaded.metadata ->> 'mimetype' is distinct from 'image/webp')
      or (pending.kind in ('video', 'gif') and uploaded.metadata ->> 'mimetype' is distinct from 'video/mp4') then
      raise exception 'uploaded attachment does not match'
        using errcode = '22023';
    end if;
    if pending.gif_path is not null then
      perform private.assert_uploaded_gif('message-attachments', pending.gif_path);
    end if;

    update private.message_attachments as attachment
    set status = 'ready',
      thumbnail_path = case
        when exists (
          select 1
          from storage.objects as object
          where object.bucket_id = 'message-attachments'
            and object.name = pending.thumbnail_path
            and object.owner_id = auth.uid()::text
            and object.metadata ->> 'mimetype' = 'image/webp'
            and nullif(object.metadata ->> 'size', '')::bigint <= 1048576
        ) then pending.thumbnail_path
      end
    where attachment.id = pending.id;
  end loop;

  select count(*)
  into ready_count
  from private.message_attachments as attachment
  where attachment.message_id = p_message_id
    and attachment.conversation_id = p_conversation_id
    and attachment.status = 'ready';

  return ready_count;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cleanup_expired_records()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  removed bigint := 0;
  affected bigint;
  korea_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- 스토리는 만료되면 읽는 경로가 없다(기능 명세 §17.6). publish하지 못한 사진 스토리는 48시간을
  -- 기다린다. Storage 2층 스윕과 같은 유예라 업로드 중인 행을 지우지 않는다. 행을 지우는 문장이
  -- 이미지 경로를 정리 큐로 옮긴다.
  with expired as (
    delete from public.stories as story
    where (story.status = 'ready' and story.expires_at <= now())
      or (story.status = 'pending' and story.created_at <= now() - interval '48 hours')
    returning story.image_path, story.thumbnail_path
  ), queued as (
    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select 'story-media', path.object_path, 'story_media'
    from expired
    cross join lateral (
      values (expired.image_path), (expired.thumbnail_path)
    ) as path(object_path)
    where path.object_path is not null
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run
  )
  select count(*) into affected from expired;
  removed := removed + affected;

  -- 메시지의 사진이 아닌 첨부는 500KB(512000바이트)를 넘으면 1년만 보관한다. 대화 맥락을 위해 행과
  -- 동영상 첫 프레임은 남기고 파일만 큐로 옮긴다. 보관 GIF는 MP4 크기로 함께 판정한다(기능 명세 §18.7).
  -- 조건을 바꾸면 `message_attachments_retention_idx`도 바꾼다.
  with expired as (
    update private.message_attachments as attachment
    set status = 'expired'
    where attachment.status = 'ready'
      and attachment.kind <> 'image'
      and attachment.size_bytes > 512000
      and attachment.created_at <= now() - interval '1 year'
    returning attachment.object_path, attachment.gif_path
  ), queued as (
    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select 'message-attachments', path.object_path, 'message_attachment'
    from expired
    cross join lateral (values (expired.object_path), (expired.gif_path)) as path(object_path)
    where path.object_path is not null
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run
  )
  select count(*) into affected from expired;
  removed := removed + affected;

  -- 게시물도 같은 기준이다. 그룹과 개인 게시물을 가르지 않고, 고정한 글은 고정된 동안 건너뛴다. 해제하면
  -- 그다음 정리 때 기간을 다시 본다. 조건을 바꾸면 `post_attachments_retention_idx`도 바꾼다.
  with expired as (
    update public.post_attachments as attachment
    set expired_at = now()
    from public.posts as post
    where post.id = attachment.post_id
      and post.pinned_at is null
      and attachment.status = 'ready'
      and attachment.expired_at is null
      and lower(attachment.mime_type) not like 'image/%'
      and attachment.size_bytes > 512000
      and attachment.created_at <= now() - interval '1 year'
    returning attachment.storage_bucket, attachment.object_path, attachment.gif_path
  ), queued as (
    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select expired.storage_bucket, path.object_path, 'post_attachment'
    from expired
    cross join lateral (values (expired.object_path), (expired.gif_path)) as path(object_path)
    where path.object_path is not null
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run
  )
  select count(*) into affected from expired;
  removed := removed + affected;

  -- 예약은 끝난 뒤 2주까지 남긴다. 반복 예약은 종료일이 정해지기 전까지 지우지 않는다.
  delete from public.utility_reservations as reservation
  where case
      when reservation.recurring then reservation.recurring_until
      else reservation.reservation_date
    end < korea_today - 14;
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- 관리자 반복 선예약도 같다. 첫 날짜가 지나도 반복이 끝나기 전에는 학생 예약을 막고 있다.
  delete from public.gongang_schedule as schedule
  where case
      when schedule.recurring then schedule.recurring_until
      else schedule.schedule_date
    end < korea_today - 14;
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- 랭킹 이벤트는 append-only 라 정리 경로임을 밝혀야 지울 수 있다(삭제 및 보존 정책 §7.4).
  perform pg_catalog.set_config('app.feed_event_purge', 'on', true);

  -- 반응 이벤트는 발행 후 6시간 이내 게시물에만 합산된다. 그보다 오래된 것은 어떤 조회에도 잡히지
  -- 않는다. 경계를 넉넉히 두려고 하루를 남긴다.
  delete from private.post_reaction_count_events
  where occurred_at < now() - interval '24 hours';
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- `#업` 이벤트는 게시물당 가장 최근 하나만 읽는다. 1시간 중복 방지 검사도 최근 구간만 보므로
  -- 최신 한 건을 남기면 두 조회가 모두 그대로 동작한다. 나머지는 죽은 데이터다.
  delete from private.feed_bump_events as bump
  where exists (
    select 1
    from private.feed_bump_events as newer
    where newer.post_id = bump.post_id
      and (newer.effective_at, newer.id) > (bump.effective_at, bump.id)
  );
  get diagnostics affected = row_count;
  removed := removed + affected;

  perform pg_catalog.set_config('app.feed_event_purge', 'off', true);

  return removed;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_storage_cleanup()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  enqueued bigint := 0;
  moved bigint;
begin
  -- Upload preparation and commits lock the parent too. Taking the same lock first prevents a new
  -- attachment from appearing after path capture but before the stale draft is deleted.
  perform 1
  from public.posts as post
  where post.published_at is null
    and post.created_at <= now() - interval '48 hours'
  for update;

  with expired as (
    delete from public.post_attachments as attachment
    where attachment.status = 'deleted'
      or (
        attachment.status = 'pending'
        and attachment.created_at <= now() - interval '48 hours'
      )
      or exists (
        select 1
        from public.posts as post
        where post.id = attachment.post_id
          and post.published_at is null
          and post.created_at <= now() - interval '48 hours'
      )
    returning
      attachment.storage_bucket as bucket,
      attachment.object_path as object_path,
      attachment.thumbnail_path as thumbnail_path,
      attachment.gif_path as gif_path
  )
  -- 첨부는 object가 여럿이다(원본, 썸네일, 보관 GIF). 행은 이미 지워졌으므로 여기서 모두
  -- 큐에 넣지 않으면 남는 쪽의 경로를 다시 알아낼 방법이 없다.
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select expired.bucket, path.object_path, 'post_attachment'
  from expired
  cross join lateral (
    values (expired.object_path), (expired.thumbnail_path), (expired.gif_path)
  ) as path(object_path)
  where path.object_path is not null
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  -- Attachments are removed and queued first so deleting the parent cannot cascade away the only
  -- copy of a ready object's path. Draft-row deletion is deliberately not included in `enqueued`.
  delete from public.posts as post
  where post.published_at is null
    and post.created_at <= now() - interval '48 hours';

  with expired as (
    delete from public.comment_images as image
    where image.status = 'deleted'
      or (
        image.status in ('pending', 'finalized')
        and image.created_at <= now() - interval '48 hours'
      )
    returning image.storage_bucket as bucket, image.object_path as object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select expired.bucket, expired.object_path, 'comment_image'
  from expired
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  with expired as (
    delete from public.group_media_objects as media
    where media.status = 'deleted'
      or (
        media.status = 'pending'
        and media.created_at <= now() - interval '48 hours'
      )
    returning media.object_path as object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'group-media', expired.object_path, 'group_media'
  from expired
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  -- 프로필 이미지만 조건이 상태가 아니라 참조다. 슬롯에서 내려와도 변경 활동 게시물이 살아
  -- 있는 동안에는 남고, 그 게시물이 삭제된 뒤에야 지울 수 있다.
  with expired as (
    delete from public.profile_media_objects as media
    where (
        media.status = 'pending'
        and media.created_at <= now() - interval '48 hours'
      )
      or (
        media.status = 'ready'
        and not exists (
          select 1
          from public.profiles as profile
          where media.object_path in (profile.avatar_path, profile.cover_path)
        )
        and not exists (
          select 1
          from public.posts as post
          where post.activity_media_path = media.object_path
        )
      )
    returning media.object_path as object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'profile-media', expired.object_path, 'profile_media'
  from expired
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  -- 아바타 슬롯과 별개인 활동용 고화질본은 활동 게시물을 지웠을 때 바로 참조를 끊고 회수한다.
  -- 슬롯용 512px object는 현재 프로필이 계속 가리킬 수 있으므로 여기서 건드리지 않는다.
  with expired as (
    select activity.id, activity.object_path
    from public.profile_media_activity_objects as activity
    where (
        activity.status = 'pending'
        and activity.created_at <= now() - interval '48 hours'
      )
      or (
        activity.status = 'ready'
        and not exists (
        select 1
        from public.posts as post
        where post.activity_media_path = activity.object_path
        )
      )
    for update
  ), deleted as (
    delete from public.profile_media_activity_objects as activity
    using expired
    where activity.id = expired.id
    returning expired.object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'profile-media', deleted.object_path, 'profile_media_activity'
  from deleted
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  -- 메시지 첨부. 지운 첨부와 전송되지 않은 채 48시간이 지난 업로드 예고를 회수한다. 사진은 원본과
  -- 축소본 두 object이고, GIF는 보관 GIF까지 셋이다.
  with expired as (
    delete from private.message_attachments as attachment
    where attachment.status = 'deleted'
      or (
        attachment.status = 'pending'
        and attachment.created_at <= now() - interval '48 hours'
      )
    returning attachment.object_path, attachment.thumbnail_path, attachment.gif_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'message-attachments', path.object_path, 'message_attachment'
  from expired
  cross join lateral (
    values (expired.object_path), (expired.thumbnail_path), (expired.gif_path)
  ) as path(object_path)
  where path.object_path is not null
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics moved = row_count;
  enqueued := enqueued + moved;

  return enqueued;
end;
$function$;

CREATE OR REPLACE FUNCTION private.message_rows (
  p_caller_profile_id bigint,
  p_conversation_id   uuid,
  p_message_ids       uuid[],
  p_keys              jsonb
)
  RETURNS TABLE (
    id                    uuid,
    sender_id             bigint,
    body                  text,
    sent_at               timestamp with time zone,
    edited_at             timestamp with time zone,
    deleted               boolean,
    reply_to_id           uuid,
    reply_sender_id       bigint,
    reply_body            text,
    reply_deleted         boolean,
    reply_attachment_kind text,
    unread_member_count   integer,
    reactions             jsonb,
    my_reaction           public.post_reaction,
    pinned                boolean,
    changed_at            timestamp with time zone,
    system_kind           text,
    system_profile_ids    bigint[],
    system_name           text,
    attachments           jsonb,
    mention_profile_ids   bigint[],
    mentions_everyone     boolean
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  with period as (
    select member.joined_at, member.left_at
    from public.conversation_members as member
    where member.conversation_id = p_conversation_id
      and member.profile_id = p_caller_profile_id
  )
  select
    message.id,
    message.sender_id,
    case
      when message.system_kind is null and message.deleted_at is null
        then private.decrypt_message_text(message.body_ciphertext, message.key_version, p_keys)
      else ''
    end,
    message.sent_at,
    message.edited_at,
    message.deleted_at is not null,
    original.id,
    original.sender_id,
    case
      when original.id is not null and original.deleted_at is null
        then left(
          private.message_plain_text(
            private.decrypt_message_text(original.body_ciphertext, original.key_version, p_keys)
          ),
          200
        )
      when original.id is not null then ''
    end,
    original.deleted_at is not null,
    case
      when original.id is not null and original.deleted_at is null then (
        select attachment.kind
        from private.message_attachments as attachment
        where attachment.message_id = original.id
          and attachment.status in ('ready', 'expired')
        order by attachment.position
        limit 1
      )
    end,
    case
      when message.system_kind is null then (
        select count(*)::integer
        from public.conversation_members as other
        where other.conversation_id = p_conversation_id
          and other.profile_id <> p_caller_profile_id
          and other.profile_id is distinct from message.sender_id
          and other.left_at is null
          and other.joined_at <= message.sent_at
          and (other.last_read_sent_at, other.last_read_message_id) < (message.sent_at, message.id)
      )
    end,
    coalesce(tally.list, '[]'::jsonb),
    mine.reaction,
    pin.message_id is not null,
    message.changed_at,
    message.system_kind,
    message.system_profile_ids,
    message.system_name,
    coalesce(files.list, '[]'::jsonb),
    message.mention_profile_ids,
    message.mentions_everyone
  from private.messages as message
  left join private.messages as original
    on original.id = message.reply_to_id
    and exists (
      select 1
      from period
      where original.sent_at >= period.joined_at
        and (period.left_at is null or original.sent_at < period.left_at)
    )
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('reaction', counted.reaction, 'count', counted.n)
      order by counted.n desc, counted.reaction
    ) as list
    from (
      select entry.reaction, count(*)::integer as n
      from private.message_reactions as entry
      where entry.message_id = message.id
      group by entry.reaction
    ) as counted
  ) as tally on true
  left join private.message_reactions as mine
    on mine.message_id = message.id
    and mine.profile_id = p_caller_profile_id
  left join private.message_pins as pin on pin.message_id = message.id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', attachment.id,
        'kind', attachment.kind,
        'mime_type', attachment.mime_type,
        'size_bytes', attachment.size_bytes,
        'width', attachment.width,
        'height', attachment.height,
        'object_path', attachment.object_path,
        'thumbnail_path', attachment.thumbnail_path,
        'gif_path', attachment.gif_path,
        'expired', attachment.status = 'expired',
        'file_name', private.decrypt_message_text(
          attachment.filename_ciphertext, attachment.key_version, p_keys
        )
      )
      order by attachment.position
    ) as list
    from private.message_attachments as attachment
    where attachment.message_id = message.id
      and attachment.conversation_id = message.conversation_id
      and attachment.status in ('ready', 'expired')
  ) as files on true
  where message.conversation_id = p_conversation_id
    and message.id = any(p_message_ids)
  order by message.sent_at, message.id;
$function$;

CREATE OR REPLACE FUNCTION private.post_attachments_json (
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
        'attachment_id', attachment.id,
        'storage_bucket', attachment.storage_bucket,
        'object_path', attachment.object_path,
        'thumbnail_path', attachment.thumbnail_path,
        'gif_path', attachment.gif_path,
        'original_filename', attachment.original_filename,
        'position', attachment.position,
        'mime_type', attachment.mime_type,
        'size_bytes', attachment.size_bytes,
        'width', attachment.width,
        'height', attachment.height,
        'media_kind', attachment.media_kind,
        'expired', attachment.expired_at is not null
      )
      order by attachment.position, attachment.id
    ),
    '[]'::jsonb
  )
  from public.post_attachments as attachment
  where attachment.post_id = p_post_id and attachment.status = 'ready';
$function$;

CREATE OR REPLACE FUNCTION private.purge_posts (
  p_post_ids uuid[]
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  purged integer;
begin
  if p_post_ids is null or pg_catalog.cardinality(p_post_ids) = 0 then
    return 0;
  end if;

  -- 랭킹 이벤트도 함께 사라져야 한다. 그 CASCADE는 append-only 트리거를 거치므로 정리 경로임을
  -- 먼저 밝힌다(삭제 및 보존 정책 §7.4).
  perform pg_catalog.set_config('app.feed_event_purge', 'on', true);

  -- 첨부는 object가 여럿이다(원본, 썸네일, GIF는 보관 GIF까지). 모두 큐에 넣지 않으면 남는 쪽은
  -- 참조가 사라진 뒤라 아무도 경로를 모르는 고아가 된다.
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select attachment.storage_bucket, path.object_path, 'post_attachment'
  from public.post_attachments as attachment
  cross join lateral (
    values (attachment.object_path), (attachment.thumbnail_path), (attachment.gif_path)
  ) as path(object_path)
  where attachment.post_id = any(p_post_ids)
    and path.object_path is not null
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;

  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select image.storage_bucket, image.object_path, 'comment_image'
  from public.comment_images as image
  where image.post_id = any(p_post_ids)
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;

  delete from public.posts as post where post.id = any(p_post_ids);
  get diagnostics purged = row_count;

  perform pg_catalog.set_config('app.feed_event_purge', 'off', true);

  -- 파일까지 수초 안에 사라지도록 워커를 깨운다. 실패해도 행 삭제는 이미 끝났고 경로는 큐에
  -- 남아 백스톱이 받는다. 그래서 이 호출은 조용해야 한다(삭제 및 보존 정책 §4.1).
  perform private.invoke_storage_cleanup(p_quiet => true);

  return purged;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_group_conversation (
  p_conversation_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target public.conversations;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  target := private.lock_group_for_member(caller_profile_id, p_conversation_id);

  if target.created_by is distinct from caller_profile_id then
    raise exception 'group owner required'
      using errcode = '42501';
  end if;

  perform realtime.send(
    jsonb_build_object('conversation_id', p_conversation_id),
    'conversation_deleted',
    'messaging:' || member.profile_id::text,
    true
  )
  from public.conversation_members as member
  where member.conversation_id = p_conversation_id
    and member.left_at is null;

  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select 'message-attachments', path.object_path, 'message_attachment'
  from private.message_attachments as attachment
  cross join lateral (
    values (attachment.object_path), (attachment.thumbnail_path), (attachment.gif_path)
  ) as path(object_path)
  where attachment.conversation_id = p_conversation_id
    and path.object_path is not null
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;

  delete from public.conversations where id = p_conversation_id;

  perform private.invoke_storage_cleanup(p_quiet => true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_post_attachment (
  p_attachment_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  attachment public.post_attachments;
begin
  select item.* into attachment from public.post_attachments as item
  where item.id = p_attachment_id for update;
  if attachment.id is null or not private.is_post_author(attachment.post_id) then
    raise exception 'only the author can delete attachments' using errcode = '42501';
  end if;
  if attachment.status = 'ready'
    and exists (
      select 1 from public.posts
      where id = attachment.post_id
        and published_at is not null
        and nullif(btrim(body), '') is null
    )
    and not exists (
      select 1 from public.post_attachments
      where post_id = attachment.post_id
        and id <> attachment.id
        and status = 'ready'
    ) then
    raise exception 'post requires a body or ready attachment' using errcode = '22023';
  end if;
  if attachment.status <> 'deleted' then
    insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
    select attachment.storage_bucket, path.object_path, 'post_attachment'
    from (
      values (attachment.object_path), (attachment.thumbnail_path), (attachment.gif_path)
    ) as path(object_path)
    where path.object_path is not null
    on conflict (bucket, object_path) do update
      set dry_run = queue.dry_run and excluded.dry_run;

    update public.post_attachments
    set status = 'deleted', deleted_at = now()
    where id = p_attachment_id;

    perform private.invoke_storage_cleanup(p_quiet => true);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_post_attachment (
  p_attachment_id uuid
)
  RETURNS public.post_attachments
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  attachment public.post_attachments;
  object_record storage.objects;
  thumbnail_record storage.objects;
  is_published boolean;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select item.* into attachment from public.post_attachments as item
  where item.id = p_attachment_id for update;
  if attachment.id is null or not private.is_post_author(attachment.post_id) then
    raise exception 'only the author can finalize attachments' using errcode = '42501';
  end if;
  if attachment.status = 'deleted' then
    raise exception 'attachment is not pending' using errcode = '55000';
  end if;
  select post.published_at is not null into is_published
  from public.posts as post
  where post.id = attachment.post_id;
  if is_published is null then
    raise exception 'post is deleted' using errcode = '55000';
  end if;
  select object.* into object_record
  from storage.objects as object
  where object.bucket_id = attachment.storage_bucket
    and object.name = attachment.object_path;
  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from auth.uid()::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from attachment.size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from attachment.mime_type then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;
  if lower(attachment.mime_type) like 'image/%'
    and attachment.size_bytes > 8388608 then
    raise exception 'image attachments must be 8 MiB or smaller' using errcode = '22023';
  end if;
  -- 보관 GIF는 썸네일과 달리 첨부의 일부다. 내려받을 때 GIF를 주는 것이 목적이라, 없거나 어긋나면
  -- `.mp4`로 조용히 떨어지지 않게 첨부 전체를 실패시킨다(기능 명세 §18.7).
  if attachment.gif_path is not null then
    perform private.assert_uploaded_gif(attachment.storage_bucket, attachment.gif_path);
  end if;

  -- 썸네일이 없으면 실패시키지 않고 경로를 지운다. 축소본은 데이터 절약 수단이지 게시물의
  -- 일부가 아니라서, 그것 하나 때문에 원본이 멀쩡한 글의 업로드를 되돌릴 이유가 없다.
  -- 읽는 쪽은 `thumbnail_path`가 없으면 원본으로 떨어지므로 화면은 그대로 동작한다.
  if attachment.thumbnail_path is not null then
    select object.* into thumbnail_record
    from storage.objects as object
    where object.bucket_id = attachment.storage_bucket
      and object.name = attachment.thumbnail_path;

    if thumbnail_record.id is null
      or thumbnail_record.owner_id is distinct from auth.uid()::text
      -- Storage metadata comes from the upload request, so do not trust the
      -- client-side compressor to enforce the thumbnail contract by itself.
      or thumbnail_record.metadata ->> 'mimetype' is distinct from 'image/webp'
      or (
        case
          when thumbnail_record.metadata ->> 'size' ~ '^[0-9]+$'
          then (thumbnail_record.metadata ->> 'size')::bigint > 1048576
          else true
        end
      ) then
      -- A rejected thumbnail is not referenced after this point. Queue the
      -- uploaded object before clearing its path so the sweeper does not have
      -- to discover it 48 hours later.
      if thumbnail_record.id is not null then
        insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
        values (attachment.storage_bucket, attachment.thumbnail_path, 'post_attachment')
        on conflict (bucket, object_path) do update
          set dry_run = queue.dry_run and excluded.dry_run;
      end if;

      update public.post_attachments
      set thumbnail_path = null
      where id = p_attachment_id
      returning * into attachment;
    end if;
  end if;

  if attachment.status = 'ready' then
    return attachment;
  end if;
  if not is_published then
    update public.post_attachments
    set status = 'ready', ready_at = now()
    where id = p_attachment_id
    returning * into attachment;
  end if;
  return attachment;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_conversation_attachments (
  p_conversation_id uuid,
  p_media           boolean,
  p_before_sent_at  timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_before_id       uuid                     DEFAULT NULL::uuid,
  p_limit           integer                  DEFAULT 30
)
  RETURNS TABLE (
    id             uuid,
    message_id     uuid,
    sender_id      bigint,
    sent_at        timestamp with time zone,
    kind           text,
    mime_type      text,
    size_bytes     bigint,
    width          integer,
    height         integer,
    object_path    text,
    thumbnail_path text,
    file_name      text,
    gif_path       text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  keys jsonb;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if (p_before_sent_at is null) <> (p_before_id is null) then
    raise exception 'cursor requires both sent_at and id'
      using errcode = '22023';
  end if;

  keys := private.message_keys();

  return query
  select
    attachment.id,
    message.id,
    message.sender_id,
    message.sent_at,
    attachment.kind,
    attachment.mime_type,
    attachment.size_bytes,
    attachment.width,
    attachment.height,
    attachment.object_path,
    attachment.thumbnail_path,
    private.decrypt_message_text(attachment.filename_ciphertext, attachment.key_version, keys),
    attachment.gif_path
  from private.message_attachments as attachment
  join private.messages as message on message.id = attachment.message_id
  where attachment.conversation_id = p_conversation_id
    and attachment.status = 'ready'
    and message.deleted_at is null
    and (attachment.kind in ('image', 'video', 'gif')) = coalesce(p_media, true)
    and (
      p_before_sent_at is null
      or (message.sent_at, attachment.id) < (p_before_sent_at, p_before_id)
    )
    and exists (
      select 1
      from public.conversation_members as period
      where period.conversation_id = p_conversation_id
        and period.profile_id = caller_profile_id
        and message.sent_at >= period.joined_at
        and (period.left_at is null or message.sent_at < period.left_at)
    )
  order by message.sent_at desc, attachment.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 101);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_conversation_attachments"(uuid, boolean, timestamp WITH time zone, uuid, integer) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.list_post_attachments (
  p_post_id uuid
)
  RETURNS TABLE (
    attachment_id     uuid,
    post_id           uuid,
    storage_bucket    text,
    object_path       text,
    thumbnail_path    text,
    original_filename text,
    "position"        integer,
    mime_type         text,
    size_bytes        bigint,
    width             integer,
    height            integer,
    media_kind        text,
    status            public.post_attachment_status,
    created_at        timestamp with time zone,
    ready_at          timestamp with time zone,
    expired           boolean,
    gif_path          text
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select item.id, item.post_id, item.storage_bucket, item.object_path,
    item.thumbnail_path, item.original_filename, item.position, item.mime_type,
    item.size_bytes, item.width, item.height, item.media_kind, item.status, item.created_at,
    item.ready_at, item.expired_at is not null, item.gif_path
  from public.post_attachments as item
  where item.post_id = p_post_id
    and item.status <> 'deleted'
    and (
      item.status = 'ready'
      or private.is_post_author(item.post_id)
    )
  order by item.position, item.id;
$function$;

REVOKE ALL ON FUNCTION "public"."list_post_attachments"(uuid) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.prepare_message_attachments (
  p_conversation_id uuid,
  p_message_id      uuid,
  p_files           jsonb
)
  RETURNS TABLE (
    attachment_id  uuid,
    object_path    text,
    thumbnail_path text,
    gif_path       text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  keys jsonb;
  file_count integer := coalesce(jsonb_array_length(p_files), 0);
  file jsonb;
  file_position integer := 0;
  file_kind text;
  file_name text;
  encrypted record;
  path text;
  thumbnail text;
  gif text;
  created_id uuid;
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;
  if p_message_id is null or jsonb_typeof(p_files) is distinct from 'array' then
    raise exception 'message id and files required'
      using errcode = '22023';
  end if;
  -- 사진은 한 메시지에 30장까지 묶는다. 그 밖의 파일은 메시지마다 하나다(기능 명세 §13.5).
  if file_count not between 1 and 30 then
    raise exception 'between 1 and 30 attachments required'
      using errcode = '22023';
  end if;
  if file_count > 1 and exists (
    select 1
    from jsonb_array_elements(p_files) as item
    where item ->> 'kind' is distinct from 'image'
  ) then
    raise exception 'several attachments must all be photos'
      using errcode = '22023';
  end if;
  -- 동영상과 GIF는 브라우저가 다시 인코딩한 `video`·`gif` 종류로만 받는다(기능 명세 §13.5). 원본을 일반
  -- 파일로 보내 우회하지 못하게 MIME type과 확장자로 막는다.
  if exists (
    select 1
    from jsonb_array_elements(p_files) as item
    where coalesce(item ->> 'kind', '') not in ('video', 'gif')
      and (
        lower(btrim(coalesce(item ->> 'mime_type', ''))) like 'video/%'
        or lower(btrim(coalesce(item ->> 'mime_type', ''))) = 'image/gif'
        or (
          lower(btrim(coalesce(item ->> 'mime_type', ''))) not like 'audio/%'
          and lower(btrim(coalesce(item ->> 'file_name', '')))
            ~ '\.(gif|mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp|3g2|mpe?g|ogv|m2ts)$'
        )
      )
  ) then
    raise exception 'videos and GIFs must be re-encoded'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_files) as item
    where item ->> 'keep_gif' = 'true'
      and item ->> 'kind' is distinct from 'gif'
  ) then
    raise exception 'only a GIF keeps an archived GIF'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.conversation_members as member
    where member.conversation_id = p_conversation_id
      and member.profile_id = caller_profile_id
      and member.left_at is null
  ) then
    raise exception 'conversation member required'
      using errcode = '42501';
  end if;
  if private.direct_counterpart_withdrawn(p_conversation_id, caller_profile_id) then
    -- 클라이언트가 이 거부만 골라 대화를 다시 읽으므로 hint로 구분한다. 권한 거부(42501)로 두면
    -- 세션 거절과 섞인다.
    raise exception 'recipient withdrawn'
      using errcode = '55000', hint = 'recipient_withdrawn';
  end if;
  if exists (select 1 from private.messages as message where message.id = p_message_id) then
    raise exception 'message already sent'
      using errcode = '23505';
  end if;

  update private.message_attachments as attachment
  set status = 'deleted'
  where attachment.message_id = p_message_id
    and attachment.status = 'pending'
    and attachment.uploader_id = caller_profile_id;

  keys := private.message_keys();

  for file in select item from jsonb_array_elements(p_files) as item loop
    file_kind := file ->> 'kind';
    file_name := btrim(coalesce(file ->> 'file_name', ''));
    if char_length(file_name) not between 1 and 255 then
      raise exception 'file name must be 1 to 255 characters'
        using errcode = '22023';
    end if;

    select * into encrypted from private.encrypt_message_text(file_name, keys);
    path := p_conversation_id::text || '/' || gen_random_uuid()::text;
    thumbnail := case when file_kind in ('image', 'video', 'gif') then path || '/thumb' end;
    -- 보관 GIF는 클라이언트가 보내겠다고 할 때만 예고한다. 그 전 버전 앱은 MP4만 올린다.
    gif := case when file ->> 'keep_gif' = 'true' then path || '/gif' end;

    insert into private.message_attachments (
      conversation_id, message_id, uploader_id, position, kind, mime_type, size_bytes,
      width, height, object_path, thumbnail_path, gif_path, filename_ciphertext, key_version
    ) values (
      p_conversation_id,
      p_message_id,
      caller_profile_id,
      file_position,
      file_kind,
      coalesce(nullif(btrim(file ->> 'mime_type'), ''), 'application/octet-stream'),
      (file ->> 'size_bytes')::bigint,
      (file ->> 'width')::integer,
      (file ->> 'height')::integer,
      path,
      thumbnail,
      gif,
      encrypted.ciphertext,
      encrypted.key_version
    )
    returning id into created_id;

    attachment_id := created_id;
    object_path := path;
    thumbnail_path := thumbnail;
    gif_path := gif;
    return next;
    file_position := file_position + 1;
  end loop;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."prepare_message_attachments"(uuid, uuid, jsonb) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.prepare_post_attachment (
  p_post_id           uuid,
  p_original_filename text,
  p_mime_type         text,
  p_size_bytes        bigint,
  p_width             integer DEFAULT NULL::integer,
  p_height            integer DEFAULT NULL::integer,
  p_media_kind        text    DEFAULT NULL::text,
  p_keep_gif          boolean DEFAULT false
)
  RETURNS public.post_attachments
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  post_record public.posts;
  attachment public.post_attachments;
  attachment_id uuid := gen_random_uuid();
  next_position integer;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record from public.posts as post
  where post.id = p_post_id
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can add attachments' using errcode = '42501';
  end if;
  -- 동영상과 GIF는 브라우저가 다시 인코딩한 MP4로만 받는다(기능 명세 §8.3). 원본은 위치 정보를 담을 수
  -- 있어 일반 파일로 우회하지 못하게 막는다. 다시 인코딩했는지 자체는 서버가 확인할 수 없다.
  if p_media_kind is not null then
    if p_media_kind not in ('video', 'gif') or btrim(p_mime_type) <> 'video/mp4' then
      raise exception 'unsupported media kind' using errcode = '22023';
    end if;
  elsif lower(btrim(p_mime_type)) like 'video/%'
     or lower(btrim(p_mime_type)) = 'image/gif'
     or lower(btrim(p_original_filename)) ~ '\.(gif|mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp|3g2|mpe?g|ogv|m2ts)$' then
    raise exception 'video attachments are not supported' using errcode = '22023';
  end if;
  if coalesce(p_keep_gif, false) and p_media_kind is distinct from 'gif' then
    raise exception 'only a GIF keeps an archived GIF' using errcode = '22023';
  end if;
  if lower(btrim(p_mime_type)) like 'image/%'
    and p_size_bytes > 8388608 then
    raise exception 'image attachments must be 8 MiB or smaller' using errcode = '22023';
  end if;
  if (select count(*) from public.post_attachments
      where post_id = p_post_id and status <> 'deleted') >= 30 then
    raise exception 'a post can have at most 30 attachments' using errcode = '23514';
  end if;

  select coalesce(min(candidate), 0) into next_position
  from generate_series(0, 29) as candidate
  where not exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status <> 'deleted' and position = candidate
  );

  -- 이미지와 동영상·GIF(첫 프레임)에만 썸네일 경로를 예고한다. pdf·hwp에는 축소본이랄 것이 없고, CHECK 제약도
  -- 이미지가 아닌 행에 `thumbnail_path`가 붙는 것을 막는다. 경로는 원본에서 파생되므로
  -- 클라이언트가 정하지 않는다 — Storage 정책이 이 행이 예고한 경로만 통과시킨다. 보관 GIF는
  -- 클라이언트가 보내겠다고 할 때만 예고한다. 그 전 버전 앱은 MP4만 올린다.
  insert into public.post_attachments (
    id, post_id, object_path, thumbnail_path, gif_path, original_filename, position,
    mime_type, size_bytes, width, height, media_kind
  ) values (
    attachment_id, p_post_id, p_post_id::text || '/' || attachment_id::text,
    case
      when lower(btrim(p_mime_type)) like 'image/%' or p_media_kind is not null
      then p_post_id::text || '/' || attachment_id::text || '/thumb'
    end,
    case
      when coalesce(p_keep_gif, false)
      then p_post_id::text || '/' || attachment_id::text || '/gif'
    end,
    btrim(p_original_filename), next_position, btrim(p_mime_type),
    p_size_bytes, p_width, p_height, p_media_kind
  ) returning * into attachment;
  return attachment;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."prepare_post_attachment"(uuid, text, text, bigint, integer, integer, text, boolean) FROM PUBLIC, "anon", "service_role";

ALTER TABLE "private"."message_attachments"
  ADD CONSTRAINT "message_attachments_gif_path_check" CHECK (((gif_path IS NULL) OR ((kind = 'gif'::text) AND (gif_path = (object_path || '/gif'::text)))));

ALTER TABLE "private"."message_attachments"
  ADD CONSTRAINT "message_attachments_gif_path_key" UNIQUE (gif_path);

ALTER TABLE "public"."post_attachments"
  ADD CONSTRAINT "post_attachments_gif_path_check" CHECK (((gif_path IS NULL) OR ((media_kind = 'gif'::text) AND (gif_path = ((object_path || '/'::text) || 'gif'::text)))));

CREATE VIEW "private"."referenced_storage_objects" AS  SELECT 'profile-media'::text AS bucket,
    profile.avatar_path AS object_path
   FROM public.profiles profile
  WHERE (profile.avatar_path IS NOT NULL)
UNION ALL
 SELECT 'profile-media'::text AS bucket,
    profile.cover_path AS object_path
   FROM public.profiles profile
  WHERE (profile.cover_path IS NOT NULL)
UNION ALL
 SELECT 'profile-media'::text AS bucket,
    post.activity_media_path AS object_path
   FROM public.posts post
  WHERE (post.activity_media_path IS NOT NULL)
UNION ALL
 SELECT 'profile-media'::text AS bucket,
    media.object_path
   FROM public.profile_media_objects media
UNION ALL
 SELECT 'profile-media'::text AS bucket,
    activity.object_path
   FROM public.profile_media_activity_objects activity
UNION ALL
 SELECT attachment.storage_bucket AS bucket,
    attachment.object_path
   FROM public.post_attachments attachment
UNION ALL
 SELECT attachment.storage_bucket AS bucket,
    attachment.thumbnail_path AS object_path
   FROM public.post_attachments attachment
  WHERE (attachment.thumbnail_path IS NOT NULL)
UNION ALL
 SELECT attachment.storage_bucket AS bucket,
    attachment.gif_path AS object_path
   FROM public.post_attachments attachment
  WHERE (attachment.gif_path IS NOT NULL)
UNION ALL
 SELECT image.storage_bucket AS bucket,
    image.object_path
   FROM public.comment_images image
UNION ALL
 SELECT 'group-media'::text AS bucket,
    media.object_path
   FROM public.group_media_objects media
UNION ALL
 SELECT 'story-media'::text AS bucket,
    story.image_path AS object_path
   FROM public.stories story
  WHERE (story.image_path IS NOT NULL)
UNION ALL
 SELECT 'story-media'::text AS bucket,
    story.thumbnail_path AS object_path
   FROM public.stories story
  WHERE (story.thumbnail_path IS NOT NULL)
UNION ALL
 SELECT 'message-attachments'::text AS bucket,
    attachment.object_path
   FROM private.message_attachments attachment
UNION ALL
 SELECT 'message-attachments'::text AS bucket,
    attachment.thumbnail_path AS object_path
   FROM private.message_attachments attachment
  WHERE (attachment.thumbnail_path IS NOT NULL)
UNION ALL
 SELECT 'message-attachments'::text AS bucket,
    attachment.gif_path AS object_path
   FROM private.message_attachments attachment
  WHERE (attachment.gif_path IS NOT NULL);

CREATE POLICY "post_attachments_storage_insert_pending_author" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'post-attachments'::"text") AND ("owner_id" = ( SELECT ("auth"."uid"())::"text" AS "uid")) AND (EXISTS ( SELECT 1
   FROM ("public"."post_attachments" "attachment"
     JOIN "public"."posts" "post" ON (("post"."id" = "attachment"."post_id")))
  WHERE (("attachment"."storage_bucket" = "objects"."bucket_id") AND ("objects"."name" IN ("attachment"."object_path", "attachment"."thumbnail_path", "attachment"."gif_path")) AND ("attachment"."status" = 'pending'::"public"."post_attachment_status") AND "private"."is_post_author"("post"."id"))))));

CREATE POLICY "post_attachments_storage_select_reader" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'post-attachments'::"text") AND "storage"."allow_any_operation"(ARRAY['object.get_authenticated_info'::"text", 'object.get_authenticated'::"text", 'object.sign'::"text", 'object.sign_many'::"text"]) AND (EXISTS ( SELECT 1
   FROM "public"."post_attachments" "attachment"
  WHERE (("attachment"."storage_bucket" = "objects"."bucket_id") AND (("objects"."name" = "attachment"."thumbnail_path") OR (("objects"."name" IN ("attachment"."object_path", "attachment"."gif_path")) AND ("attachment"."expired_at" IS NULL))) AND ("attachment"."status" = 'ready'::"public"."post_attachment_status") AND "private"."can_read_post"("attachment"."post_id"))))));

REVOKE ALL ON FUNCTION "private"."assert_uploaded_gif"(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_conversation_attachments"(uuid, boolean, timestamp WITH time zone, uuid, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_conversation_attachments"(uuid, boolean, timestamp WITH time zone, uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_conversation_attachments"(uuid, boolean, timestamp WITH time zone, uuid, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_post_attachments"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_post_attachments"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_post_attachments"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."prepare_message_attachments"(uuid, uuid, jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_message_attachments"(uuid, uuid, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."prepare_message_attachments"(uuid, uuid, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."prepare_post_attachment"(uuid, text, text, bigint, integer, integer, text, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_post_attachment"(uuid, text, text, bigint, integer, integer, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."prepare_post_attachment"(uuid, text, text, bigint, integer, integer, text, boolean) TO "postgres";
