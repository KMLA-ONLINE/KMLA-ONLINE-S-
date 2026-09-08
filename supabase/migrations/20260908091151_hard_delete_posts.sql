-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER TABLE public.posts
  DROP CONSTRAINT posts_publication_timestamps;

DROP INDEX public.posts_category_recent_idx;

DROP INDEX public.posts_group_pinned_idx;

DROP INDEX public.posts_group_recent_idx;

DROP INDEX public.posts_group_search_idx;

DROP INDEX public.posts_public_profile_feed_idx;

DROP INDEX public.posts_timeline_idx;

DROP TRIGGER posts_cleanup_group_reports ON public.posts;

DROP FUNCTION private.cleanup_group_post_reports();

DROP TRIGGER posts_tombstone_comment_images ON public.posts;

DROP FUNCTION private.tombstone_post_comment_images();

-- 소프트 삭제로 쌓여 있던 게시물을 실제로 지운다. 컬럼만 떨어뜨리면 이미 삭제된 게시물이 화면에
-- 되살아나므로 이 블록은 반드시 DROP COLUMN 앞에 온다.
--
-- 첨부와 댓글 이미지의 경로를 먼저 큐로 옮긴다. CASCADE가 그 행을 지우고 나면 object 경로를 다시
-- 찾을 방법이 없다. private.purge_posts()는 이 마이그레이션 뒤쪽에서 만들어지므로 여기서는 같은
-- 순서를 직접 편다. 랭킹 이벤트 CASCADE를 위해 가드도 직접 세운다(삭제 및 보존 정책 §7.4).
select set_config('app.feed_event_purge', 'on', true);

insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
select attachment.storage_bucket, attachment.object_path, 'post_attachment'
from public.post_attachments as attachment
join public.posts as post on post.id = attachment.post_id
where post.deleted_at is not null
on conflict (bucket, object_path) do update
  set dry_run = queue.dry_run and excluded.dry_run;

insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
select image.storage_bucket, image.object_path, 'comment_image'
from public.comment_images as image
join public.posts as post on post.id = image.post_id
where post.deleted_at is not null
on conflict (bucket, object_path) do update
  set dry_run = queue.dry_run and excluded.dry_run;

delete from public.posts where deleted_at is not null;

select set_config('app.feed_event_purge', 'off', true);

-- 컬럼을 참조하는 의존체를 먼저 푼다. 정책과 뷰가 `posts.deleted_at`을 붙들고 있는 한
-- DROP COLUMN 은 거부된다.
-- Storage 정책은 schema diff가 잡지 못하므로 직접 다시 만든다. 이 정책은 `posts.deleted_at`을
-- 참조하고 있었고, 컬럼이 사라지면 정책 본문이 그대로 깨진다.
drop policy if exists "post_attachments_storage_insert_pending_author" on storage.objects;

create policy "post_attachments_storage_insert_pending_author"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'post-attachments'
  and owner_id = (select auth.uid()::text)
  and exists (
    select 1
    from public.post_attachments as attachment
    join public.posts as post on post.id = attachment.post_id
    where attachment.storage_bucket = storage.objects.bucket_id
      and attachment.object_path = storage.objects.name
      and attachment.status = 'pending'
      and private.is_post_author(post.id)
  )
);

CREATE OR REPLACE VIEW private.referenced_storage_objects AS SELECT 'profile-media'::text AS bucket,
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
 SELECT attachment.storage_bucket AS bucket,
    attachment.object_path
   FROM public.post_attachments attachment
UNION ALL
 SELECT image.storage_bucket AS bucket,
    image.object_path
   FROM public.comment_images image
UNION ALL
 SELECT 'group-media'::text AS bucket,
    media.object_path
   FROM public.group_media_objects media;

ALTER TABLE public.posts
  DROP COLUMN deleted_at;

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
      )
  ) then
    raise exception 'uploaded attachment metadata does not match' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null and attachment_count = 0 then
    raise exception 'post requires a body or ready attachment' using errcode = '22023';
  end if;

  update public.post_attachments
  set status = 'deleted', deleted_at = now()
  where post_id = p_post_id
    and status <> 'deleted'
    and not (id = any(coalesce(p_attachment_ids, '{}'::uuid[])));

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

CREATE OR REPLACE FUNCTION private.assert_group_anonymous_activity_allowed (
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

CREATE OR REPLACE FUNCTION private.assert_group_invite_manager (
  p_group_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target_group public.groups;
  caller_role public.group_member_role;
begin
  select group_record.*
  into target_group
  from public.groups as group_record
  where group_record.id = p_group_id
    and group_record.deleted_at is null;

  if target_group.id is null then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  -- 공식 그룹에는 초대할 사람이 없다. 승인된 재학생은 트리거로 자동 가입하고, 교사는
  -- `sync_student_official_memberships`가 다시 지운다.
  if target_group.kind = 'official' then
    raise exception 'official groups cannot be invited to' using errcode = '55000';
  end if;

  select membership.role
  into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = private.current_profile_id();

  if caller_role is null or caller_role not in ('owner', 'admin') then
    raise exception 'group staff required' using errcode = '42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.can_access_feed_post (
  p_post_id    uuid,
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
    where post.id = p_post_id
      and post.published_at is not null
      and (
        (
          post.kind = 'group'
          and exists (
            select 1
            from public.group_memberships as membership
            join public.groups as group_record on group_record.id = membership.group_id
            where membership.group_id = post.group_id
              and membership.profile_id = p_profile_id
              and group_record.deleted_at is null
          )
        )
        or (
          post.kind = 'profile'
          and post.visibility = 'public'
          and timeline.id is not null
          and (
            author.profile_id = post.timeline_profile_id
            or (
              (
                private.feed_profile_cohorts(p_profile_id)
                  && private.feed_profile_cohorts(post.timeline_profile_id)
              )
              and viewer.gender = timeline.gender
            )
          )
          and (
            post.activity_kind is null
            or post.timeline_profile_id = p_profile_id
            or timeline.type = 'teacher'
            or (
              viewer.cohort = timeline.cohort
              and viewer.gender = timeline.gender
            )
          )
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_manage_group (
  p_group_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select auth.uid() is not null and exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = private.current_profile_id()
      and membership.role in ('owner', 'admin')
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_read_comment_image_object (
  p_storage_bucket text,
  p_object_path    text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.comment_images as image
    join public.post_comments as comment on comment.id = image.comment_id
    where image.storage_bucket = p_storage_bucket
      and image.object_path = p_object_path
      and image.status = 'ready'
      and comment.deleted_at is null
      and private.can_read_post(image.post_id)
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_read_group_media (
  p_object_path text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.groups as group_record
      join public.profiles as profile
        on profile.auth_user_id = auth.uid()
        and profile.status = 'accepted'
        and profile.deleted_at is null
      where p_object_path in (group_record.icon_path, group_record.cover_path)
        and (
          (
            profile.type in ('student', 'alumni')
            and (
              group_record.kind = 'official'
              or (
                group_record.kind = 'unofficial'
                and group_record.join_policy <> 'invite_only'
              )
            )
          )
          or (
            group_record.kind = 'unofficial'
            and private.is_group_member(group_record.id)
          )
        )
    );
$function$;

CREATE OR REPLACE FUNCTION private.can_read_post (
  p_post_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select private.current_profile_id() is not null
    and exists (
      select 1
      from public.posts as post
      where post.id = p_post_id
        and case
          -- 게시 전 초안은 첨부를 올리려는 작성자에게만 보인다.
          when post.published_at is null then private.is_post_author(post.id)
          when post.kind = 'group' then private.is_group_member(post.group_id)
          when post.visibility = 'public' then true
          -- 비공개 개인 게시물의 작성자는 CHECK상 타임라인 당사자와 같다.
          else private.is_post_author(post.id)
        end
    );
$function$;

CREATE OR REPLACE FUNCTION private.can_read_profile_media_path (
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
    from public.profiles as viewer
    where viewer.auth_user_id = auth.uid()
      and viewer.status = 'accepted'
      and viewer.deleted_at is null
  )
  and (
    exists (
      select 1
      from public.profiles as target
      where target.status = 'accepted'
        and target.deleted_at is null
        and p_object_path in (target.avatar_path, target.cover_path)
    )
    or exists (
      select 1
      from public.posts as post
      join public.profiles as timeline
        on timeline.id = post.timeline_profile_id
        and timeline.status = 'accepted'
        and timeline.deleted_at is null
      where post.activity_media_path = p_object_path
        and post.published_at is not null
        and private.can_read_post(post.id)
    )
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_upload_comment_image_object (
  p_storage_bucket text,
  p_object_path    text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.comment_images as image
    where image.storage_bucket = p_storage_bucket
      and image.object_path = p_object_path
      and image.status = 'pending'
      and private.is_comment_image_uploader(image.id)
      and private.can_read_post(image.post_id)
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_upload_group_media (
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
    from public.group_media_objects as media
    where media.object_path = p_object_path
      and media.status = 'pending'
      and private.can_manage_group(media.group_id)
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_upload_profile_media (
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
    from public.profile_media_objects as media
    join public.profiles as profile on profile.id = media.profile_id
    where media.object_path = p_object_path
      and media.status = 'pending'
      and profile.auth_user_id = auth.uid()
      and profile.status = 'accepted'
      and profile.deleted_at is null
  );
$function$;

CREATE OR REPLACE FUNCTION private.capture_effective_feed_bump()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if new.depth <> 0
    or new.author_identity not in ('identified', 'staff')
    or btrim(new.body) <> '#업' then
    return new;
  end if;

  if not exists (
    select 1
    from public.posts as post
    where post.id = new.post_id
      and post.kind = 'group'
      and post.published_at is not null
  ) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('feed-bump:' || new.post_id::text, 0)
  );

  if not exists (
    select 1
    from private.feed_bump_events as bump
    where bump.post_id = new.post_id
      and bump.effective_at > new.created_at - interval '1 hour'
  ) then
    insert into private.feed_bump_events (post_id, comment_id, effective_at)
    values (new.post_id, new.id, new.created_at);
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.capture_post_reaction_count_event()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if tg_op = 'INSERT' then
    insert into private.post_reaction_count_events (post_id, delta, occurred_at)
    values (new.post_id, 1, new.created_at);
  elsif tg_op = 'DELETE'
    and coalesce(
      pg_catalog.current_setting('app.feed_event_purge', true), ''
    ) <> 'on' then
    insert into private.post_reaction_count_events (post_id, delta)
    values (old.post_id, -1);
  end if;
  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION private.claim_storage_cleanup (
  p_limit         integer DEFAULT 100,
  p_lease_seconds integer DEFAULT 300
)
  RETURNS TABLE (
    id          uuid,
    bucket      text,
    object_path text,
    lease_id    uuid
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  lease uuid := gen_random_uuid();
begin
  if p_limit not between 1 and 500 or p_lease_seconds not between 30 and 3600 then
    raise exception 'invalid cleanup lease parameters' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select queue.id
    from private.storage_cleanup_queue as queue
    where not queue.dry_run
      and queue.next_attempt_at <= now()
      and (queue.lease_expires_at is null or queue.lease_expires_at <= now())
    order by queue.next_attempt_at, queue.enqueued_at, queue.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update private.storage_cleanup_queue as queue
    set lease_id = lease,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from candidates
    where queue.id = candidates.id
    returning queue.id, queue.bucket, queue.object_path
  )
  select claimed.id, claimed.bucket, claimed.object_path, lease
  from claimed;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cleanup_expired_feed_sessions()
  RETURNS bigint
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with deleted as (
    delete from private.feed_sessions
    where expires_at <= statement_timestamp()
    returning 1
  )
  select count(*) from deleted;
$function$;

CREATE OR REPLACE FUNCTION private.cleanup_expired_notifications()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  removed bigint;
begin
  delete from public.notifications
  where last_activity_at < now() - interval '30 days';
  get diagnostics removed = row_count;
  delete from private.notification_event_keys
  where notification_id is null and created_at < now() - interval '30 days';
  return removed;
end;
$function$;

CREATE OR REPLACE FUNCTION private.comment_author_label (
  p_identity public.post_identity,
  p_alias    smallint,
  p_name     text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select case p_identity
    when 'identified' then p_name
    when 'staff' then '운영진'
    when 'anonymous' then
      case when p_alias = 0 then '글쓴이' else '익명' || p_alias::text end
  end;
$function$;

CREATE OR REPLACE FUNCTION private.comment_post_context (
  p_post_id           uuid,
  p_caller_profile_id bigint,
  OUT                 is_visible boolean,
  OUT                 post_kind public.post_kind,
  OUT                 caller_role public.group_member_role,
  OUT                 identity_policy public.group_identity_policy,
  OUT                 post_author_identity public.post_identity
)
  RETURNS record
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  post_record public.posts;
begin
  is_visible := false;

  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id
    and post.published_at is not null;
  if post_record.id is null then
    return;
  end if;
  post_kind := post_record.kind;
  post_author_identity := post_record.author_identity;

  if post_record.kind = 'group' then
    select membership.role into caller_role
    from public.group_memberships as membership
    where membership.group_id = post_record.group_id
      and membership.profile_id = p_caller_profile_id;
    if caller_role is null then
      raise exception 'group membership required' using errcode = '42501';
    end if;
    select group_data.identity_policy into identity_policy
    from public.groups as group_data
    where group_data.id = post_record.group_id;
    is_visible := true;
    return;
  end if;

  -- 전체 공개 개인 게시물은 승인 사용자 전체가, 비공개는 작성자 본인만 읽고 쓴다
  -- (기능 명세 §9.1). `caller_role`은 null로 남아 타인 댓글 삭제 권한이 생기지 않는다.
  is_visible := private.can_read_post(p_post_id);
end;
$function$;

CREATE OR REPLACE FUNCTION private.comment_reaction_summary (
  p_comment_id        uuid,
  p_caller_profile_id bigint
)
  RETURNS TABLE (
    reaction_count integer,
    top_reactions  public.post_reaction[],
    my_reaction    public.post_reaction
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with tally as (
    select
      entry.reaction,
      count(*)::integer as n,
      row_number() over (order by count(*) desc, entry.reaction) as rank
    from public.comment_reactions as entry
    where entry.comment_id = p_comment_id
    group by entry.reaction
  )
  select
    coalesce((select sum(tally.n)::integer from tally), 0),
    coalesce(
      (
        select array_agg(ranked.reaction order by ranked.n desc, ranked.reaction)
        from tally as ranked
        where ranked.rank <= 3
      ),
      array[]::public.post_reaction[]
    ),
    (
      select mine.reaction
      from public.comment_reactions as mine
      where mine.comment_id = p_comment_id and mine.profile_id = p_caller_profile_id
    );
$function$;

CREATE OR REPLACE FUNCTION private.complete_storage_cleanup (
  p_lease_id    uuid,
  p_ids         uuid[],
  p_removed_ids uuid[] DEFAULT '{}'::uuid[],
  p_error       text   DEFAULT NULL::text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  completed integer;
begin
  if p_lease_id is null or p_ids is null then
    raise exception 'invalid cleanup completion parameters' using errcode = '22023';
  end if;

  delete from private.storage_cleanup_queue as queue
  where queue.id = any(p_ids)
    and queue.lease_id = p_lease_id
    and queue.lease_expires_at > now()
    and (
      queue.id = any(coalesce(p_removed_ids, '{}'::uuid[]))
      or not exists (
        select 1
        from storage.objects as object
        where object.bucket_id = queue.bucket
          and object.name = queue.object_path
      )
    );
  get diagnostics completed = row_count;

  -- 남은 것은 실제로 지워지지 않았다. 지수 백오프로 미루고 리스를 풀어 다음 실행이 다시
  -- 가져갈 수 있게 한다. attempts는 증가 전 값이라 첫 실패가 1분, 이후 2·4·8분으로 벌어지고
  -- 하루에서 멈춘다.
  update private.storage_cleanup_queue
  set attempts = attempts + 1,
    last_error = left(p_error, 500),
    lease_id = null,
    lease_expires_at = null,
    next_attempt_at = now() + least(
      make_interval(mins => (2 ^ least(attempts, 11))::integer),
      interval '24 hours'
    )
  where id = any(p_ids)
    and lease_id = p_lease_id;

  return completed;
end;
$function$;

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
  candidate record;
  next_position integer := 1;
  page_counts jsonb := '{}'::jsonb;
  last_source_type text;
  last_source_id text;
  consecutive_count integer := 0;
  source_count integer;
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

  create temporary table if not exists feed_ranked_candidates (
    priority bigint primary key,
    post_id uuid not null unique,
    rank_time timestamptz not null,
    source_type text not null,
    source_id text not null
  ) on commit drop;
  truncate table feed_ranked_candidates;

  insert into feed_ranked_candidates (
    priority, post_id, rank_time, source_type, source_id
  )
  select
    row_number() over (
      order by ranked.rank_time desc, ranked.published_at desc, ranked.post_id desc
    ),
    ranked.post_id,
    ranked.rank_time,
    ranked.source_type,
    ranked.source_id
  from (
    select
      post.id as post_id,
      post.published_at,
      private.feed_rank_time(
        post.published_at,
        bump.effective_at,
        epoch,
        coalesce(reaction.total, 0),
        coalesce(comment.total, 0),
        post.kind = 'profile' and author.profile_id <> post.timeline_profile_id,
        post.activity_kind is not null
      ) as rank_time,
      case post.kind when 'group' then 'group' else 'profile' end as source_type,
      case post.kind
        when 'group' then post.group_id::text
        else author.profile_id::text
      end as source_id
    from public.posts as post
    join private.post_authors as author on author.post_id = post.id
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
      and private.can_access_feed_post(post.id, p_profile_id)
  ) as ranked;

  while exists (select 1 from feed_ranked_candidates) loop
    if (next_position - 1) % 20 = 0 then
      page_counts := '{}'::jsonb;
    end if;

    select item.* into candidate
    from feed_ranked_candidates as item
    where coalesce((page_counts ->> (item.source_type || ':' || item.source_id))::integer, 0)
        < case item.source_type when 'profile' then 4 else 10 end
      and not (
        item.source_type = last_source_type
        and item.source_id = last_source_id
        and consecutive_count >= case item.source_type when 'profile' then 2 else 3 end
      )
    order by item.priority
    limit 1;

    if not found then
      select item.* into candidate
      from feed_ranked_candidates as item
      order by item.priority
      limit 1;
    end if;

    insert into private.feed_session_posts (session_id, position, post_id, rank_time)
    values (session_id, next_position, candidate.post_id, candidate.rank_time);
    delete from feed_ranked_candidates where post_id = candidate.post_id;

    source_count := coalesce(
      (page_counts ->> (candidate.source_type || ':' || candidate.source_id))::integer,
      0
    ) + 1;
    page_counts := jsonb_set(
      page_counts,
      array[candidate.source_type || ':' || candidate.source_id],
      to_jsonb(source_count),
      true
    );

    if candidate.source_type = last_source_type
      and candidate.source_id = last_source_id then
      consecutive_count := consecutive_count + 1;
    else
      last_source_type := candidate.source_type;
      last_source_id := candidate.source_id;
      consecutive_count := 1;
    end if;

    next_position := next_position + 1;
  end loop;

  return session_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.emit_notification (
  p_event_key            text,
  p_recipient_profile_id bigint,
  p_kind                 public.notification_kind,
  p_importance           public.notification_importance,
  p_category             public.notification_category,
  p_actor_identity       public.notification_actor_identity,
  p_actor_profile_id     bigint,
  p_actor_display_name   text,
  p_actor_avatar_path    text,
  p_title                text,
  p_group_id             uuid                               DEFAULT NULL::uuid,
  p_post_id              uuid                               DEFAULT NULL::uuid,
  p_comment_id           uuid                               DEFAULT NULL::uuid,
  p_target_profile_id    bigint                             DEFAULT NULL::bigint,
  p_reservation_id       bigint                             DEFAULT NULL::bigint,
  p_aggregate_key        text                               DEFAULT NULL::text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  created_notification_id uuid;
begin
  if p_recipient_profile_id is null
    or p_event_key is null
    or p_actor_profile_id = p_recipient_profile_id then
    return null;
  end if;

  if p_group_id is not null and p_category = 'content' and exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = p_recipient_profile_id
      and membership.notification_level = 'none'
  ) then
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(coalesce(p_aggregate_key, p_event_key), 0)
  );

  insert into private.notification_event_keys (event_key)
  values (p_event_key)
  on conflict do nothing;
  if not found then
    select event.notification_id into created_notification_id
    from private.notification_event_keys as event
    where event.event_key = p_event_key;
    return created_notification_id;
  end if;

  if p_aggregate_key is not null then
    select event.notification_id into created_notification_id
    from private.notification_event_keys as event
    where event.event_key = p_aggregate_key
    for update;
  end if;

  if created_notification_id is not null then
    update public.notifications
    set actor_identity = p_actor_identity,
      actor_profile_id = case when p_actor_identity = 'identified' then p_actor_profile_id end,
      actor_display_name = p_actor_display_name,
      actor_avatar_path = p_actor_avatar_path,
      actor_count = actor_count + 1,
      last_activity_at = now(),
      read_at = null
    where id = created_notification_id;
  else
    insert into public.notifications (
      recipient_profile_id, kind, importance, category, actor_identity,
      actor_profile_id, actor_display_name, actor_avatar_path, group_id, post_id,
      comment_id, target_profile_id, reservation_id, title
    ) values (
      p_recipient_profile_id, p_kind, p_importance, p_category, p_actor_identity,
      case when p_actor_identity = 'identified' then p_actor_profile_id end,
      p_actor_display_name, p_actor_avatar_path, p_group_id, p_post_id,
      p_comment_id, p_target_profile_id, p_reservation_id, btrim(p_title)
    ) returning id into created_notification_id;

    if p_aggregate_key is not null then
      insert into private.notification_event_keys (event_key, notification_id)
      values (p_aggregate_key, created_notification_id)
      on conflict (event_key) do update set notification_id = excluded.notification_id;
    end if;

    perform private.enqueue_notification_push(created_notification_id);
  end if;

  update private.notification_event_keys as event
  set notification_id = created_notification_id
  where event.event_key = p_event_key;

  return created_notification_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_notification_email (
  p_notification_id uuid,
  p_recipient_email text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if nullif(btrim(p_recipient_email), '') is null then
    return false;
  end if;

  insert into private.notification_delivery_outbox (
    notification_id, recipient_profile_id, channel, recipient_email
  )
  select notification.id, notification.recipient_profile_id, 'email', btrim(p_recipient_email)
  from public.notifications as notification
  where notification.id = p_notification_id
  on conflict do nothing;
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_notification_push (
  p_notification_id uuid
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target public.notifications;
  inserted_count integer;
begin
  select notification.* into target
  from public.notifications as notification
  where notification.id = p_notification_id;

  if target.id is null then
    return 0;
  end if;

  insert into private.notification_delivery_outbox (
    notification_id, recipient_profile_id, subscription_id, channel
  )
  select target.id, target.recipient_profile_id, subscription.id, 'web_push'
  from private.web_push_subscriptions as subscription
  where subscription.profile_id = target.recipient_profile_id
    and private.notification_push_allowed(
      target, subscription.created_at, subscription.expiration_time
    )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
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
    returning attachment.storage_bucket as bucket, attachment.object_path as object_path
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select expired.bucket, expired.object_path, 'post_attachment'
  from expired
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

  return enqueued;
end;
$function$;

CREATE OR REPLACE FUNCTION private.feed_profile_cohorts (
  p_profile_id bigint
)
  RETURNS smallint[]
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select case
    when profile.type = 'student' and profile.cohort is not null then
      case when profile.is_returning_student
        then array[profile.cohort, (profile.cohort + 1)::smallint]
        else array[profile.cohort]
      end
    when profile.type = 'alumni'
      and profile.cohort is not null
      and exists (
        select 1
        from public.profiles as student
        where student.type = 'student'
          and student.status = 'accepted'
          and student.deleted_at is null
          and student.cohort = profile.cohort
      ) then array[profile.cohort]
    else '{}'::smallint[]
  end
  from public.profiles as profile
  where profile.id = p_profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null;
$function$;

CREATE OR REPLACE FUNCTION private.feed_rank_time (
  p_published_at              timestamp with time zone,
  p_bumped_at                 timestamp with time zone,
  p_feed_epoch                timestamp with time zone,
  p_reaction_count            integer,
  p_ranking_comment_count     integer,
  p_is_cross_timeline         boolean,
  p_is_profile_media_activity boolean
)
  RETURNS timestamp WITH time zone
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path TO ''
  AS $function$
  select greatest(
    p_bumped_at,
    (
      case
        when p_published_at <= p_feed_epoch
          and p_published_at > p_feed_epoch - interval '6 hours' then
          p_published_at
          + make_interval(secs => least(
              (greatest(coalesce(p_reaction_count, 0), 0) * 4
                + greatest(coalesce(p_ranking_comment_count, 0), 0) * 8) * 60.0,
              greatest(
                0.0,
                2400.0 * (
                  1.0 - extract(epoch from (p_feed_epoch - p_published_at)) / 21600.0
                )
              )
            ))
          - case when coalesce(p_is_cross_timeline, false)
              then interval '1 hour' else interval '0' end
        else p_published_at
      end
    ) - case
      when coalesce(p_is_profile_media_activity, false)
        and p_published_at <= p_feed_epoch
        and p_published_at > p_feed_epoch - interval '6 hours'
        then interval '10 minutes'
      else interval '0'
    end
  );
$function$;

CREATE OR REPLACE FUNCTION private.generate_profile_pub_id()
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  candidate text;
begin
  perform pg_catalog.pg_advisory_xact_lock(783094812);

  loop
    candidate := encode(extensions.gen_random_bytes(6), 'hex');
    exit when not exists (
      select 1
      from public.profiles as profile
      where lower(profile.pub_id::text) = candidate
    );
  end loop;

  return candidate;
end;
$function$;

CREATE OR REPLACE FUNCTION private.group_anonymous_activity_restricted (
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

CREATE OR REPLACE FUNCTION private.initialize_group_memberships()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  creator public.profiles;
begin
  select profile.*
  into creator
  from public.profiles as profile
  where profile.id = new.created_by
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if creator.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if new.kind = 'official'
    and (creator.role <> 'admin' or creator.type = 'teacher') then
    raise exception 'official group creation is not allowed' using errcode = '42501';
  end if;

  if new.kind = 'official' then
    perform pg_catalog.pg_advisory_xact_lock(4815162342);

    insert into public.group_memberships (group_id, profile_id)
    select new.id, profile.id
    from public.profiles as profile
    where profile.status = 'accepted'
      and profile.type = 'student'
      and profile.deleted_at is null
    on conflict on constraint group_memberships_pkey do nothing;
  end if;

  insert into public.group_memberships (group_id, profile_id, role)
  values (new.id, creator.id, 'owner')
  on conflict on constraint group_memberships_pkey do update set role = excluded.role;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.invoke_notification_dispatcher()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  project_url text;
  dispatcher_secret text;
  request_id bigint;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into dispatcher_secret
  from vault.decrypted_secrets where name = 'notification_dispatch_secret';
  if project_url is null or dispatcher_secret is null then return null; end if;
  select net.http_post(
    url := project_url || '/functions/v1/dispatch-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', dispatcher_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  ) into request_id;
  return request_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.invoke_storage_cleanup (
  p_quiet boolean DEFAULT false
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  project_url text;
  cleanup_secret text;
  request_id bigint;
begin
  -- 가져갈 것이 없으면 부르지 않는다. 백스톱이 자주 돌아도 빈 실행 기록이 쌓이지 않아, 관리자
  -- 화면의 "마지막 실행"이 실제로 무언가를 처리한 실행을 가리킨다.
  if not exists (
    select 1
    from private.storage_cleanup_queue as queue
    where not queue.dry_run and queue.next_attempt_at <= now()
  ) then
    return null;
  end if;

  -- 진행 중인 실행이 있으면 겹쳐 부르지 않는다. 게시물을 잇달아 지워도 호출은 한 번이면 된다.
  if exists (
    select 1
    from private.storage_cleanup_runs as run
    where run.finished_at is null and run.started_at > now() - interval '2 minutes'
  ) then
    return null;
  end if;

  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'project_url';

  select decrypted_secret into cleanup_secret
  from vault.decrypted_secrets
  where name = 'storage_cleanup_secret';

  if project_url is null or cleanup_secret is null then
    if p_quiet then
      return null;
    end if;
    raise exception 'storage cleanup vault configuration is missing'
      using errcode = '55000';
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/cleanup-storage-objects',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', cleanup_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request_id;

  insert into private.storage_cleanup_runs (request_id) values (request_id);
  return request_id;
exception
  when others then
    -- 조용한 호출은 어떤 실패도 밖으로 내보내지 않는다. 이 블록은 하위 트랜잭션이라 여기서
    -- 되감기면 위에서 건 pg_net 요청도 함께 사라진다.
    if p_quiet then
      return null;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION private.is_comment_image_uploader (
  p_image_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select auth.uid() is not null
    and exists (
      select 1
      from private.comment_image_uploaders as uploader
      where uploader.image_id = p_image_id
        and uploader.profile_id = private.current_profile_id()
    );
$function$;

CREATE OR REPLACE FUNCTION private.is_group_member (
  p_group_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = private.current_profile_id()
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_post_author (
  p_post_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select auth.uid() is not null
    and exists (
      select 1
      from private.post_authors as author
      where author.post_id = p_post_id
        and author.profile_id = private.current_profile_id()
    );
$function$;

CREATE OR REPLACE FUNCTION private.lock_group_anonymous_activity_target (
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

CREATE OR REPLACE FUNCTION private.lock_group_for_join_request()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  current_join_policy public.group_join_policy;
begin
  select group_record.join_policy
  into current_join_policy
  from public.groups as group_record
  where group_record.id = new.group_id
  for update;

  if current_join_policy is distinct from 'request' then
    raise exception 'group does not accept join requests' using errcode = '55000';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.lock_reaction_context (
  p_post_id           uuid,
  p_caller_profile_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform 1
  from public.posts as post
  where post.id = p_post_id
    and post.published_at is not null
  for update;

  if not found then
    raise exception 'post not found' using errcode = 'P0002';
  end if;

  perform private.reaction_context(p_post_id, p_caller_profile_id);
end;
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
  select p_delivery.channel = 'email'
    or exists (
      select 1
      from public.notifications as notification
      join private.web_push_subscriptions as subscription
        on subscription.id = p_delivery.subscription_id
      where notification.id = p_delivery.notification_id
        and subscription.profile_id = p_delivery.recipient_profile_id
        and private.notification_push_allowed(
          notification, subscription.created_at, subscription.expiration_time
        )
        and (
          notification.category = 'moderation'
          or notification.kind in (
            'group_deleted', 'group_join_rejected',
            'account_approved', 'account_blocked', 'account_unblocked'
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
                and group_record.deleted_at is null
            )
          )
          or (notification.post_id is null and notification.group_id is null)
        )
    );
$function$;

CREATE OR REPLACE FUNCTION private.notification_push_allowed (
  p_notification                 public.notifications,
  p_subscription_created_at      timestamp with time zone,
  p_subscription_expiration_time timestamp with time zone
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select p_subscription_created_at <= p_notification.created_at
    and (
      p_subscription_expiration_time is null
      or p_subscription_expiration_time > now()
    )
    and p_notification.kind not in ('post_reacted', 'comment_reacted', 'application_submitted')
    and (
      p_notification.category = 'moderation'
      or case p_notification.category
        when 'content' then coalesce(preference.content_push_enabled, true)
        when 'timeline' then coalesce(preference.timeline_push_enabled, true)
        when 'group' then coalesce(preference.group_push_enabled, true)
        when 'account' then coalesce(preference.account_push_enabled, true)
        when 'school' then coalesce(preference.school_push_enabled, true)
        when 'moderation' then true
      end
    )
    and (
      p_notification.group_id is null
      or p_notification.category <> 'content'
      or exists (
        select 1
        from public.group_memberships as membership
        where membership.group_id = p_notification.group_id
          and membership.profile_id = p_notification.recipient_profile_id
          and membership.notification_level <> 'none'
          and membership.content_push_enabled
      )
    )
    and (
      p_notification.kind <> 'group_posted'
      or exists (
        select 1
        from public.group_memberships as membership
        where membership.group_id = p_notification.group_id
          and membership.profile_id = p_notification.recipient_profile_id
          and membership.notification_level = 'all'
          and membership.new_post_push_enabled
      )
    )
  from (select 1) as singleton
  left join public.notification_preferences as preference
    on preference.profile_id = p_notification.recipient_profile_id;
$function$;

CREATE OR REPLACE FUNCTION private.notify_comment_created()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor_profile_id bigint := private.current_profile_id();
  recipient_profile_id bigint;
  target_post public.posts;
  actor_profile public.profiles;
  actor_identity public.notification_actor_identity := new.author_identity::text::public.notification_actor_identity;
  notification_title text;
begin
  if actor_profile_id is null then return new; end if;
  select post.* into target_post from public.posts as post where post.id = new.post_id;
  if target_post.id is null
    or (target_post.kind = 'profile' and target_post.visibility = 'private') then
    return new;
  end if;

  if new.parent_comment_id is not null then
    select author.profile_id into recipient_profile_id
    from private.comment_authors as author
    where author.comment_id = new.parent_comment_id;
    notification_title := '내 댓글에 새 답글이 등록되었습니다.';
  else
    select author.profile_id into recipient_profile_id
    from private.post_authors as author
    where author.post_id = new.post_id;
    notification_title := '내 게시물에 새 댓글이 등록되었습니다.';
  end if;

  select profile.* into actor_profile
  from public.profiles as profile where profile.id = actor_profile_id;
  perform private.emit_notification(
    'comment:' || new.id::text,
    recipient_profile_id,
    (case when new.parent_comment_id is null then 'post_commented' else 'comment_replied' end)::public.notification_kind,
    'normal', 'content', actor_identity, actor_profile_id,
    case actor_identity
      when 'identified' then coalesce(actor_profile.name, '탈퇴한 사용자')
      when 'anonymous' then '익명'
      else '운영진'
    end,
    case when actor_identity = 'identified' then actor_profile.avatar_path end,
    notification_title, target_post.group_id, new.post_id, new.id,
    target_post.timeline_profile_id
  );
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.notify_group_anonymous_activity_restricted()
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

CREATE OR REPLACE FUNCTION private.notify_group_changed()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor_profile_id bigint := private.current_profile_id();
  recipient record;
  event_kind public.notification_kind;
  event_importance public.notification_importance;
  event_title text;
begin
  if actor_profile_id is null then return new; end if;
  if old.deleted_at is null and new.deleted_at is not null then
    event_kind := 'group_deleted';
    event_importance := 'high';
    event_title := '그룹이 영구 삭제되었습니다.';
  elsif old.join_policy is distinct from new.join_policy
    or old.identity_policy is distinct from new.identity_policy
    or old.posting_policy is distinct from new.posting_policy then
    event_kind := 'group_policy_changed';
    event_importance := 'normal';
    event_title := '그룹 운영 정책이 변경되었습니다.';
  else
    return new;
  end if;

  for recipient in select profile_id from public.group_memberships where group_id = new.id
  loop
    perform private.emit_notification(
      'group-change:' || new.id::text || ':' || txid_current()::text || ':' || recipient.profile_id::text,
      recipient.profile_id, event_kind, event_importance, 'group', 'staff',
      actor_profile_id, '운영진', null, event_title, new.id
    );
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.notify_group_join_requested()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor_profile public.profiles;
  recipient record;
begin
  if private.current_profile_id() is null then return new; end if;
  select profile.* into actor_profile
  from public.profiles as profile where profile.id = new.profile_id;
  for recipient in
    select membership.profile_id
    from public.group_memberships as membership
    where membership.group_id = new.group_id and membership.role in ('owner', 'admin')
  loop
    perform private.emit_notification(
      'group-join-request:' || new.id::text || ':recipient:' || recipient.profile_id::text,
      recipient.profile_id, 'group_join_requested', 'normal', 'group', 'identified',
      new.profile_id, actor_profile.name, actor_profile.avatar_path,
      '새 그룹 가입 요청이 있습니다.', new.group_id
    );
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.notify_official_group_joined()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  group_record public.groups;
begin
  select group_data.* into group_record
  from public.groups as group_data where group_data.id = new.group_id;
  if group_record.kind = 'official'
    and private.current_profile_id() is not null
    and private.current_profile_id() is distinct from new.profile_id then
    perform private.emit_notification(
      'official-group-joined:' || new.group_id::text || ':' || new.profile_id::text,
      new.profile_id, 'official_group_joined', 'normal', 'group', 'system', null,
      group_record.name, null, '공식 그룹에 자동 가입되었습니다.', new.group_id
    );
  end if;
  return new;
end;
$function$;

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

CREATE OR REPLACE FUNCTION private.notify_profile_changed()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  actor_profile_id bigint := private.current_profile_id();
  notification_id uuid;
  event_kind public.notification_kind;
  event_importance public.notification_importance;
  event_title text;
  recipient_email text;
begin
  if actor_profile_id is null then return new; end if;
  if old.status is distinct from new.status and new.status in ('accepted', 'blocked', 'draft') then
    event_kind := case new.status
      when 'accepted' then 'account_approved'
      when 'blocked' then 'account_blocked'
      else 'account_unblocked'
    end;
    event_importance := 'high';
    event_title := case new.status
      when 'accepted' then '가입이 승인되었습니다.'
      when 'blocked' then '가입이 차단되었습니다.'
      else '차단이 해제되었습니다.'
    end;
    notification_id := private.emit_notification(
      'account-status:' || new.id::text || ':' || txid_current()::text,
      new.id, event_kind, event_importance, 'account', 'staff', actor_profile_id,
      '운영진', null, event_title, null, null, null, new.id
    );
    select user_record.email into recipient_email
    from auth.users as user_record where user_record.id = new.auth_user_id;
    perform private.enqueue_notification_email(notification_id, recipient_email);
  elsif old.role is distinct from new.role then
    perform private.emit_notification(
      'app-role:' || new.id::text || ':' || txid_current()::text,
      new.id,
      (case when new.role = 'admin' then 'app_admin_granted' else 'app_admin_revoked' end)::public.notification_kind,
      'high', 'account', 'staff', actor_profile_id, '운영진', null,
      case when new.role = 'admin'
        then '앱 관리자로 임명되었습니다.'
        else '앱 관리자 권한이 해제되었습니다.'
      end,
      null, null, null, new.id
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.notify_profile_permission_changed()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target_profile_id bigint := coalesce(new.profile_id, old.profile_id);
  actor_profile_id bigint := private.current_profile_id();
begin
  if actor_profile_id is null then return coalesce(new, old); end if;
  if coalesce(new.permission_key, old.permission_key) = 'gongang.manage' then
    perform private.emit_notification(
      'gongang-manager:' || target_profile_id::text || ':' || txid_current()::text,
      target_profile_id,
      (case when tg_op = 'INSERT' then 'gongang_manager_granted' else 'gongang_manager_revoked' end)::public.notification_kind,
      'normal', 'account', 'staff', actor_profile_id, '운영진', null,
      case when tg_op = 'INSERT'
        then '공강 관리 권한이 부여되었습니다.'
        else '공강 관리 권한이 해제되었습니다.'
      end,
      null, null, null, target_profile_id
    );
  end if;
  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION private.notify_reaction_created()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  recipient_profile_id bigint;
  target_post public.posts;
  actor_profile public.profiles;
  target_comment_id uuid;
  target_post_id uuid;
  notification_kind public.notification_kind;
  aggregate_key text;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'post_reactions' then
    target_post_id := new.post_id;
    notification_kind := 'post_reacted';
    aggregate_key := 'post-reactions:' || new.post_id::text;
    select author.profile_id into recipient_profile_id
    from private.post_authors as author where author.post_id = new.post_id;
  else
    target_comment_id := new.comment_id;
    notification_kind := 'comment_reacted';
    aggregate_key := 'comment-reactions:' || new.comment_id::text;
    select comment.post_id, author.profile_id
    into target_post_id, recipient_profile_id
    from public.post_comments as comment
    join private.comment_authors as author on author.comment_id = comment.id
    where comment.id = new.comment_id and comment.deleted_at is null;
  end if;

  select post.* into target_post from public.posts as post where post.id = target_post_id;
  if target_post.id is null
    or (target_post.kind = 'profile' and target_post.visibility = 'private') then
    return new;
  end if;
  select profile.* into actor_profile
  from public.profiles as profile where profile.id = new.profile_id;
  perform private.emit_notification(
    aggregate_key || ':actor:' || new.profile_id::text,
    recipient_profile_id, notification_kind, 'low', 'content', 'identified',
    new.profile_id, coalesce(actor_profile.name, '탈퇴한 사용자'), actor_profile.avatar_path,
    '새 반응이 등록되었습니다.', target_post.group_id, target_post_id,
    target_comment_id, target_post.timeline_profile_id, null, aggregate_key
  );
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.post_reaction_summary (
  p_post_id           uuid,
  p_caller_profile_id bigint
)
  RETURNS TABLE (
    reaction_count integer,
    top_reactions  public.post_reaction[],
    my_reaction    public.post_reaction
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with tally as (
    select
      entry.reaction,
      count(*)::integer as n,
      row_number() over (order by count(*) desc, entry.reaction) as rank
    from public.post_reactions as entry
    where entry.post_id = p_post_id
    group by entry.reaction
  )
  select
    coalesce((select sum(tally.n)::integer from tally), 0),
    coalesce(
      (
        select array_agg(ranked.reaction order by ranked.n desc, ranked.reaction)
        from tally as ranked
        where ranked.rank <= 3
      ),
      array[]::public.post_reaction[]
    ),
    (
      select mine.reaction
      from public.post_reactions as mine
      where mine.post_id = p_post_id and mine.profile_id = p_caller_profile_id
    );
$function$;

CREATE OR REPLACE FUNCTION private.prepare_group_notification_preferences()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if exists (
    select 1 from public.groups as group_record
    where group_record.id = new.group_id and group_record.kind = 'official'
  ) then
    new.notification_level := 'all';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.prevent_comment_immutable_changes()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if new.id is distinct from old.id
    or new.post_id is distinct from old.post_id
    or new.parent_comment_id is distinct from old.parent_comment_id
    or new.root_comment_id is distinct from old.root_comment_id
    or new.depth is distinct from old.depth
    or new.author_identity is distinct from old.author_identity
    or new.display_author_profile_id is distinct from old.display_author_profile_id
    or new.anon_alias_number is distinct from old.anon_alias_number
    or new.created_at is distinct from old.created_at then
    raise exception 'comment identity and thread position cannot be changed'
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.prevent_group_identity_changes()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if new.id <> old.id
    or new.slug <> old.slug
    or new.slug_is_custom <> old.slug_is_custom
    or new.kind <> old.kind then
    raise exception 'group identity cannot be changed' using errcode = '55000';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.prevent_post_immutable_changes()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if new.id is distinct from old.id
    or new.kind is distinct from old.kind
    or new.group_id is distinct from old.group_id
    or new.timeline_profile_id is distinct from old.timeline_profile_id
    or (
      (
        new.author_identity is distinct from old.author_identity
        or new.display_author_profile_id is distinct from old.display_author_profile_id
      )
      and not (
        current_setting('app.update_group_post_draft_identity', true) = old.id::text
        and old.published_at is null
        and old.kind = 'group'
        and old.activity_kind is null
      )
    )
    or new.body_format_version is distinct from old.body_format_version
    or new.activity_kind is distinct from old.activity_kind
    or new.activity_media_path is distinct from old.activity_media_path
    or new.created_at is distinct from old.created_at
    or (
      new.visibility is distinct from old.visibility
      and not (
        current_setting('app.commit_post', true) = '1'
        and old.kind = 'profile'
        and old.activity_kind is null
        and new.visibility is not null
      )
    )
    or (
      new.published_at is distinct from old.published_at
      and not (old.published_at is null and new.published_at is not null)
    ) then
    raise exception 'post identity and publication fields cannot be changed'
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.prevent_profile_activity_attachments()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if exists (
    select 1
    from public.posts as post
    where post.id = new.post_id
      and post.activity_kind is not null
  ) then
    raise exception 'profile activity posts cannot have attachments'
      using errcode = '55000';
  end if;
  return new;
end;
$function$;

CREATE FUNCTION private.purge_posts (
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

  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason)
  select attachment.storage_bucket, attachment.object_path, 'post_attachment'
  from public.post_attachments as attachment
  where attachment.post_id = any(p_post_ids)
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

REVOKE ALL ON FUNCTION private.purge_posts(uuid[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.reaction_context (
  p_post_id           uuid,
  p_caller_profile_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  post_record public.posts;
  group_record public.groups;
begin
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id
    and post.published_at is not null;
  if post_record.id is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if post_record.kind = 'profile' then
    if not private.can_read_post(p_post_id) then
      raise exception 'post is not accessible' using errcode = '42501';
    end if;
    return;
  end if;
  select group_data.* into group_record
  from public.groups as group_data
  where group_data.id = post_record.group_id;
  if group_record.id is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.group_memberships as membership
    where membership.group_id = group_record.id
      and membership.profile_id = p_caller_profile_id
  ) then
    raise exception 'group membership required' using errcode = '42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.read_post_comments (
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

CREATE OR REPLACE FUNCTION private.read_profile_posts (
  p_post_ids          uuid[],
  p_caller_profile_id bigint
)
  RETURNS TABLE (
    post_id             uuid,
    body                text,
    timeline_pub_id     text,
    timeline_name       text,
    author_pub_id       text,
    author_name         text,
    author_avatar_path  text,
    activity_kind       public.profile_media_activity_kind,
    activity_media_path text,
    visibility          public.post_visibility,
    published_at        timestamp with time zone,
    edited_at           timestamp with time zone,
    comment_count       integer,
    reaction_count      integer,
    top_reactions       public.post_reaction[],
    my_reaction         public.post_reaction,
    is_author           boolean,
    can_edit            boolean,
    can_delete          boolean
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select
    post.id,
    post.body,
    timeline.pub_id,
    timeline.name,
    author_profile.pub_id,
    author_profile.name,
    author_profile.avatar_path,
    post.activity_kind,
    post.activity_media_path,
    post.visibility,
    post.published_at,
    post.edited_at,
    post.comment_count,
    summary.total,
    summary.top,
    mine.reaction,
    author.profile_id = p_caller_profile_id,
    author.profile_id = p_caller_profile_id and post.activity_kind is null,
    author.profile_id = p_caller_profile_id
      or post.timeline_profile_id = p_caller_profile_id
  from public.posts as post
  join private.post_authors as author on author.post_id = post.id
  join public.profiles as timeline
    on timeline.id = post.timeline_profile_id
    and timeline.status = 'accepted'
    and timeline.deleted_at is null
  left join public.profiles as author_profile
    on author_profile.id = post.display_author_profile_id
    and author_profile.status = 'accepted'
    and author_profile.deleted_at is null
  left join public.post_reactions as mine
    on mine.post_id = post.id and mine.profile_id = p_caller_profile_id
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
      from public.post_reactions as entry
      where entry.post_id = post.id
      group by entry.reaction
    ) as tally
  ) as summary on true
  where post.id = any(p_post_ids)
    and post.kind = 'profile'
  order by post.published_at desc, post.id desc;
$function$;

CREATE OR REPLACE FUNCTION private.reconcile_storage_cleanup_runs()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  affected integer;
begin
  update private.storage_cleanup_runs as run
  set finished_at = response.created,
    status_code = response.status_code,
    error = nullif(coalesce(response.error_msg, ''), ''),
    claimed = nullif(private.storage_cleanup_response_field(response.content_type, response.content, 'claimed'), -1),
    removed = nullif(private.storage_cleanup_response_field(response.content_type, response.content, 'removed'), -1),
    failed = nullif(private.storage_cleanup_response_field(response.content_type, response.content, 'failed'), -1)
  from net._http_response as response
  where response.id = run.request_id
    and run.finished_at is null;
  get diagnostics affected = row_count;

  -- 응답 행이 정리된 뒤에도 열려 있는 기록은 결과를 알 수 없다. 영원히 "실행 중"으로 남겨
  -- 화면을 오해하게 두지 않는다.
  update private.storage_cleanup_runs
  set finished_at = now(),
    error = coalesce(error, 'response expired before reconciliation')
  where finished_at is null
    and started_at <= now() - interval '6 hours';

  delete from private.storage_cleanup_runs
  where started_at < now() - interval '30 days';

  return affected;
end;
$function$;

CREATE OR REPLACE FUNCTION private.recount_group_members (
  p_group_id uuid
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  update public.groups as group_record
  set member_count = (
    select count(*)::bigint
    from public.group_memberships as membership
    where membership.group_id = p_group_id
  )
  where group_record.id = p_group_id;
$function$;

CREATE OR REPLACE FUNCTION private.reject_feed_event_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if "tg_op" = 'DELETE'
    and "pg_catalog"."current_setting"('app.feed_event_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'feed ranking events are append-only' using errcode = '55000';
end;
$function$;

CREATE OR REPLACE FUNCTION private.storage_cleanup_response_field (
  p_content_type text,
  p_content      text,
  p_key          text
)
  RETURNS integer
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  parsed jsonb;
begin
  if p_content is null or coalesce(p_content_type, '') not like 'application/json%' then
    return -1;
  end if;
  parsed := p_content::jsonb;
  return coalesce((parsed ->> p_key)::integer, -1);
exception when others then
  return -1;
end;
$function$;

CREATE OR REPLACE FUNCTION private.sweep_unreferenced_storage_objects (
  p_dry_run boolean DEFAULT true,
  p_limit   integer DEFAULT 1000
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  enqueued bigint;
begin
  if p_limit not between 1 and 10000 then
    raise exception 'invalid sweep limit' using errcode = '22023';
  end if;

  with unreferenced as (
    select object.bucket_id as bucket, object.name as object_path
    from storage.objects as object
    where object.bucket_id in ('profile-media', 'group-media', 'post-attachments')
      and object.created_at <= now() - interval '48 hours'
      and not coalesce(object.is_delete_marker, false)
      and not exists (
        select 1
        from private.referenced_storage_objects as reference
        where reference.bucket = object.bucket_id
          and reference.object_path = object.name
      )
    order by object.created_at
    limit p_limit
  )
  insert into private.storage_cleanup_queue as queue (bucket, object_path, reason, dry_run)
  select
    unreferenced.bucket,
    unreferenced.object_path,
    'unreferenced_sweep',
    coalesce(p_dry_run, true)
  from unreferenced
  on conflict (bucket, object_path) do update
    set dry_run = queue.dry_run and excluded.dry_run;
  get diagnostics enqueued = row_count;

  return enqueued;
end;
$function$;

CREATE OR REPLACE FUNCTION private.sync_group_member_count()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if tg_op = 'INSERT' then
    update public.groups
    set member_count = member_count + 1
    where id = new.group_id;
  elsif tg_op = 'DELETE' then
    update public.groups
    set member_count = greatest(member_count - 1, 0)
    where id = old.group_id;
  end if;

  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION private.sync_post_comment_count()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null then
      update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    end if;
  elsif tg_op = 'DELETE' then
    if old.deleted_at is null then
      update public.posts
      set comment_count = greatest(comment_count - 1, 0)
      where id = old.post_id;
    end if;
  elsif old.deleted_at is null and new.deleted_at is not null then
    update public.posts
    set comment_count = greatest(comment_count - 1, 0)
    where id = new.post_id;
  elsif old.deleted_at is not null and new.deleted_at is null then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.sync_student_official_memberships()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not (
    tg_op = 'INSERT'
    or old.status is distinct from new.status
    or old.type is distinct from new.type
    or old.deleted_at is distinct from new.deleted_at
  ) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(4815162342);

  if new.status = 'accepted'
    and new.type = 'student'
    and new.deleted_at is null then
    insert into public.group_memberships (group_id, profile_id)
    select group_record.id, new.id
    from public.groups as group_record
    where group_record.kind = 'official'
    on conflict on constraint group_memberships_pkey do nothing;
  elsif new.type = 'teacher'
    or new.status <> 'accepted'
    or new.deleted_at is not null then
    if exists (
      select 1
      from public.group_memberships as membership
      join public.groups as group_record on group_record.id = membership.group_id
      where membership.profile_id = new.id
        and membership.role = 'owner'
        and group_record.kind = 'official'
    ) then
      raise exception 'official group owner must transfer ownership before losing eligibility'
        using errcode = '23514';
    end if;

    delete from public.group_memberships as membership
    using public.groups as group_record
    where membership.group_id = group_record.id
      and membership.profile_id = new.id
      and group_record.kind = 'official';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.tombstone_comment_images()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  update public.comment_images
  set status = 'deleted', deleted_at = now()
  where comment_id = new.id and status = 'ready';
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_profile_activity_path()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  owner_auth_user_id uuid;
  media_slot text;
begin
  if new.activity_kind is null then
    return new;
  end if;

  select profile.auth_user_id
  into owner_auth_user_id
  from public.profiles as profile
  where profile.id = new.timeline_profile_id;

  media_slot := case new.activity_kind
    when 'avatar_changed' then 'avatar'
    when 'cover_changed' then 'cover'
  end;

  if owner_auth_user_id is null
    or new.activity_media_path !~ (
      '^' || owner_auth_user_id::text || '/' || media_slot
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  then
    raise exception 'profile activity media path must belong to the timeline owner'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.accept_group_invite (
  p_token text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile public.profiles;
  invite_record private.group_invites;
  invited_group public.groups;
begin
  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if caller_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  -- 프로필 종류를 보지 않는다. `group_memberships_join_open` 정책은 교사를 막지만 그 정책이
  -- 막는 것은 "스스로 가입"이고, 초대 수락은 definer라 그 옆을 지난다. 교사는 그룹을 찾을
  -- 수도 가입 요청을 넣을 수도 없으므로 초대가 교사의 유일한 가입 경로다.

  select invite.*
  into invite_record
  from private.group_invites as invite
  where invite.token = p_token;

  if invite_record.group_id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if invite_record.expires_at <= now() then
    raise exception 'invite expired' using errcode = '55000';
  end if;

  select group_record.*
  into invited_group
  from public.groups as group_record
  where group_record.id = invite_record.group_id
    and group_record.deleted_at is null;

  if invited_group.id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  -- 발급 시점에도 막지만, 링크가 만들어진 뒤 그룹이 공식으로 바뀌는 경로가 생기더라도
  -- 수락이 뚫리지 않도록 여기서 한 번 더 본다.
  if invited_group.kind = 'official' then
    raise exception 'official groups cannot be invited to' using errcode = '55000';
  end if;

  -- 이미 멤버면 역할을 그대로 둔다. 관리자가 자기 링크를 눌러 멤버로 강등되면 안 된다.
  insert into public.group_memberships (group_id, profile_id, role)
  values (invited_group.id, caller_profile.id, 'member')
  on conflict on constraint group_memberships_pkey do nothing;

  -- 대기 중이던 가입 요청을 걷어 낸다. 남겨 두면 운영진 목록에 유령이 쌓이고, 요청이 남아
  -- 있는 동안에는 `update_group_settings`가 가입 정책 변경도 막는다.
  delete from public.group_join_requests as join_request
  where join_request.group_id = invited_group.id
    and join_request.profile_id = caller_profile.id;

  return invited_group.slug;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_storage_cleanup_status()
  RETURNS TABLE (
    secrets_configured       boolean,
    queue_pending            integer,
    queue_retrying           integer,
    queue_dry_run            integer,
    queue_oldest_enqueued_at timestamp with time zone,
    last_run_started_at      timestamp with time zone,
    last_run_finished_at     timestamp with time zone,
    last_run_status_code     integer,
    last_run_removed         integer,
    last_run_failed          integer,
    last_run_error           text,
    last_cron_status         text,
    last_cron_at             timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_app_admin();

  return query
  with queue_summary as (
    select
      count(*) filter (where not queue.dry_run)::integer as pending,
      count(*) filter (where not queue.dry_run and queue.attempts > 0)::integer as retrying,
      count(*) filter (where queue.dry_run)::integer as dry_run,
      min(queue.enqueued_at) filter (where not queue.dry_run) as oldest
    from private.storage_cleanup_queue as queue
  ), last_run as (
    select run.*
    from private.storage_cleanup_runs as run
    order by run.started_at desc
    limit 1
  ), last_cron as (
    select detail.status, detail.start_time
    from cron.job_run_details as detail
    join cron.job as job on job.jobid = detail.jobid
    where job.jobname = 'drain-storage-cleanup-hourly'
    order by detail.start_time desc
    limit 1
  )
  select
    (
      exists (select 1 from vault.decrypted_secrets where name = 'project_url')
      and exists (select 1 from vault.decrypted_secrets where name = 'storage_cleanup_secret')
    ),
    queue_summary.pending,
    queue_summary.retrying,
    queue_summary.dry_run,
    queue_summary.oldest,
    last_run.started_at,
    last_run.finished_at,
    last_run.status_code,
    last_run.removed,
    last_run.failed,
    last_run.error,
    last_cron.status,
    last_cron.start_time
  from queue_summary
  left join last_run on true
  left join last_cron on true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_group_join_request (
  p_group_id   uuid,
  p_request_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  requested_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = p_group_id for update;

  if not exists (
    select 1
    from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
      and caller_membership.role in ('owner', 'admin')
  ) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  delete from public.group_join_requests as join_request
  where join_request.group_id = p_group_id
    and join_request.id = p_request_id
  returning join_request.profile_id into requested_profile_id;

  if requested_profile_id is null then
    raise exception 'join request not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = requested_profile_id
      and profile.status = 'accepted'
      and profile.type in ('student', 'alumni')
      and profile.deleted_at is null
  ) then
    raise exception 'requesting profile is no longer eligible' using errcode = '55000';
  end if;

  insert into public.group_memberships (group_id, profile_id, role)
  values (p_group_id, requested_profile_id, 'member')
  on conflict on constraint group_memberships_pkey do nothing;

  perform private.emit_notification(
    'group-join-approved:' || p_request_id::text,
    requested_profile_id, 'group_join_approved', 'normal', 'group', 'staff',
    caller_profile_id, '운영진', null, '그룹 가입 요청이 승인되었습니다.', p_group_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_group_anonymous_activity_restriction (
  p_source_kind text,
  p_source_id   uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_group_id uuid;
  target_profile_id bigint;
  caller_role public.group_member_role;
  target_restriction private.group_anonymous_activity_restrictions;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_source_kind not in ('post', 'comment') or p_source_id is null then
    raise exception 'invalid anonymous moderation source' using errcode = '22023';
  end if;
  if p_source_kind = 'post' then
    select post.group_id, author.profile_id into target_group_id, target_profile_id
    from public.posts as post
    join public.groups as group_record on group_record.id = post.group_id and group_record.deleted_at is null
    join private.post_authors as author on author.post_id = post.id
    where post.id = p_source_id and post.kind = 'group'
      and post.author_identity = 'anonymous'
      and post.published_at is not null;
  else
    select post.group_id, author.profile_id into target_group_id, target_profile_id
    from public.post_comments as comment
    join public.posts as post on post.id = comment.post_id and post.kind = 'group'
      and post.published_at is not null
    join public.groups as group_record on group_record.id = post.group_id and group_record.deleted_at is null
    join private.comment_authors as author on author.comment_id = comment.id
    where comment.id = p_source_id and comment.author_identity = 'anonymous'
      and comment.deleted_at is null;
  end if;
  if target_profile_id is null then
    raise exception 'anonymous moderation source not found' using errcode = 'P0002';
  end if;

  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = target_group_id and membership.profile_id = caller_profile_id;
  if caller_role not in ('owner', 'admin') then
    raise exception 'group anonymous moderation is not allowed' using errcode = '42501';
  end if;
  if target_profile_id = caller_profile_id then
    raise exception 'cannot moderate own anonymous activity' using errcode = '42501';
  end if;

  perform private.lock_group_anonymous_activity_target(target_group_id, target_profile_id);
  perform 1 from public.group_memberships as membership
  where membership.group_id = target_group_id and membership.profile_id = target_profile_id
  for update;
  select restriction.* into target_restriction
  from private.group_anonymous_activity_restrictions as restriction
  where restriction.group_id = target_group_id and restriction.profile_id = target_profile_id
  order by restriction.created_at desc, restriction.id desc limit 1 for update;
  if target_restriction.id is null then
    raise exception 'anonymous activity restriction not found' using errcode = 'P0002';
  end if;
  if target_restriction.cancelled_at is not null then
    raise exception 'anonymous activity restriction already cancelled' using errcode = '55000';
  end if;
  if target_restriction.ended_at is not null or target_restriction.expires_at <= now() then
    raise exception 'anonymous activity restriction is expired' using errcode = '55000';
  end if;
  update private.group_anonymous_activity_restrictions
  set ended_at = now(), cancelled_at = now(), cancelled_by_profile_id = caller_profile_id
  where id = target_restriction.id;
  return target_restriction.id;
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
    importance      public.notification_importance,
    category        public.notification_category,
    grouping_key    uuid,
    title           text,
    body            text,
    tag             text
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
  )
  select claimed.id, claimed.lease_id, claimed.channel,
    subscription.endpoint, subscription.p256dh, subscription.auth,
    claimed.recipient_email, notification.id,
    notification.importance, notification.category,
    subscription.id,
    notification.title,
    case notification.kind
      when 'post_commented' then '내 게시물에 새 댓글이 등록되었습니다.'
      when 'comment_replied' then '내 댓글에 새 답글이 등록되었습니다.'
      when 'group_posted' then '그룹에 새 게시물이 등록되었습니다.'
      when 'account_approved' then '가입이 승인되었습니다.'
      when 'account_blocked' then '가입이 차단되었습니다.'
      when 'account_unblocked' then '차단이 해제되었습니다.'
      when 'anonymous_activity_restricted' then '그룹 익명 활동이 제한되었습니다.'
      else '새 알림이 있습니다.'
    end,
    case
      when notification.importance = 'high'
        then 'notification:' || notification.id::text
      else 'notification-category:' || notification.category::text || ':' || subscription.id::text
    end
  from claimed
  left join private.web_push_subscriptions as subscription
    on subscription.id = claimed.subscription_id
  left join public.notifications as notification
    on notification.id = claimed.notification_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_storage_cleanup (
  p_limit         integer DEFAULT 100,
  p_lease_seconds integer DEFAULT 300
)
  RETURNS TABLE (
    id          uuid,
    bucket      text,
    object_path text,
    lease_id    uuid
  )
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  select * from private.claim_storage_cleanup(p_limit, p_lease_seconds);
$function$;

CREATE OR REPLACE FUNCTION public.clear_comment_reaction (
  p_comment_id uuid
)
  RETURNS TABLE (
    reaction_count integer,
    top_reactions  public.post_reaction[],
    my_reaction    public.post_reaction
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_post_id uuid;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select comment.post_id into target_post_id
  from public.post_comments as comment
  where comment.id = p_comment_id;
  if target_post_id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  perform private.lock_reaction_context(target_post_id, caller_profile_id);

  perform 1
  from public.post_comments as comment
  where comment.id = p_comment_id
    and comment.post_id = target_post_id
    and comment.deleted_at is null
  for update;
  if not found then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  delete from public.comment_reactions as target
  where target.comment_id = p_comment_id and target.profile_id = caller_profile_id;

  return query select * from private.comment_reaction_summary(p_comment_id, caller_profile_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.clear_post_reaction (
  p_post_id uuid
)
  RETURNS TABLE (
    reaction_count integer,
    top_reactions  public.post_reaction[],
    my_reaction    public.post_reaction
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  perform private.lock_reaction_context(p_post_id, caller_profile_id);

  delete from public.post_reactions as target
  where target.post_id = p_post_id and target.profile_id = caller_profile_id;

  return query select * from private.post_reaction_summary(p_post_id, caller_profile_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.commit_group_post (
  p_post_id        uuid,
  p_title          text,
  p_body           text,
  p_attachment_ids uuid[],
  p_publish        boolean DEFAULT false,
  p_category_id    uuid    DEFAULT NULL::uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  target_group_id uuid;
  target_author_identity public.post_identity;
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.group_id, post.author_identity into target_group_id, target_author_identity
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group';
  if target_group_id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can commit this post' using errcode = '42501';
  end if;
  if coalesce(p_publish, false) and target_author_identity = 'anonymous' then
    perform private.lock_group_anonymous_activity_target(
      target_group_id, caller_profile_id
    );
  end if;

  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = target_group_id and group_data.deleted_at is null
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
    and post.group_id = target_group_id
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can commit this post' using errcode = '42501';
  end if;
  if coalesce(p_publish, false) and post_record.published_at is not null then
    raise exception 'post is already published' using errcode = '55000';
  end if;
  if coalesce(p_publish, false) then
    if group_posting_policy = 'staff'
      and member_role not in ('owner', 'admin', 'manager') then
      raise exception 'group posting is restricted to staff' using errcode = '42501';
    end if;
    if post_record.author_identity = 'anonymous'
      and group_identity_policy = 'identified' then
      raise exception 'anonymous posting is not allowed' using errcode = '42501';
    end if;
    if post_record.author_identity = 'anonymous' then
      perform private.assert_group_anonymous_activity_allowed(
        target_group_id, caller_profile_id
      );
    end if;
    if post_record.author_identity = 'staff'
      and member_role not in ('owner', 'admin', 'manager') then
      raise exception 'staff identity is not allowed' using errcode = '42501';
    end if;
  end if;
  if nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 100 then
    raise exception 'title must contain between 1 and 100 characters' using errcode = '22023';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.group_categories as category
    where category.id = p_category_id and category.group_id = post_record.group_id
  ) then
    raise exception 'category must belong to the group' using errcode = '22023';
  end if;

  perform private.apply_post_commit(p_post_id, p_body, p_attachment_ids);
  update public.posts
  set title = btrim(p_title), body = coalesce(p_body, ''), category_id = p_category_id,
    published_at = case when coalesce(p_publish, false) then now() else published_at end,
    edited_at = case when published_at is not null then now() else null end
  where id = p_post_id;
  return p_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.commit_profile_post (
  p_post_id        uuid,
  p_body           text,
  p_attachment_ids uuid[],
  p_publish        boolean                DEFAULT false,
  p_visibility     public.post_visibility DEFAULT NULL::public.post_visibility
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  next_visibility public.post_visibility;
  content_changed boolean;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'profile'
  for update;
  -- 타임라인 당사자는 타인이 쓴 글을 수정할 수 없다(기능 명세 §12.4). 작성자만 통과한다.
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can commit this post' using errcode = '42501';
  end if;
  if coalesce(p_publish, false) and post_record.published_at is not null then
    raise exception 'post is already published' using errcode = '55000';
  end if;

  -- 공개 범위는 자기 타임라인 글에서만 고를 수 있다(기능 명세 §8.4).
  if post_record.timeline_profile_id = caller_profile_id then
    next_visibility := coalesce(p_visibility, post_record.visibility);
  else
    next_visibility := 'public';
  end if;

  -- 타인 작성 허용을 꺼도 기존 게시물은 유지하므로 수정은 막지 않는다. 아직 게시되지 않은
  -- 초안은 새 게시물이라, 게시하는 순간의 허용 값을 다시 본다(기능 명세 §8.4).
  if coalesce(p_publish, false)
    and post_record.timeline_profile_id <> caller_profile_id
    and not exists (
      select 1 from public.profiles as profile
      where profile.id = post_record.timeline_profile_id
        and profile.status = 'accepted'
        and profile.deleted_at is null
        and profile.allow_timeline_posts
    ) then
    raise exception 'timeline owner does not accept posts' using errcode = '42501';
  end if;

  -- 공개 범위만 바꾼 것은 수정이 아니다. 첨부를 재배치하기 전에 재어 두어야 원래 순서와
  -- 비교할 수 있다(`apply_post_commit`이 position과 status를 갈아엎는다).
  --
  -- `ready`만 세는 것이 핵심이다. 게시된 글에서 `finalize_post_attachment`는 새 첨부를
  -- `pending`으로 남기므로 `ready`가 곧 "이번 편집 전부터 있던 것"이다. `status <> 'deleted'`로
  -- 세면 방금 올린 첨부까지 들어가 양쪽 배열이 같아지고, 사진만 더한 수정이 수정이 아닌 것이
  -- 된다.
  content_changed := coalesce(p_body, '') is distinct from post_record.body
    or coalesce(p_attachment_ids, '{}'::uuid[]) is distinct from (
      select coalesce(array_agg(attachment.id order by attachment.position), '{}'::uuid[])
      from public.post_attachments as attachment
      where attachment.post_id = p_post_id and attachment.status = 'ready'
    );

  perform private.apply_post_commit(p_post_id, p_body, p_attachment_ids);

  perform set_config('app.commit_post', '1', true);
  update public.posts
  set body = coalesce(p_body, ''),
    visibility = next_visibility,
    published_at = case when coalesce(p_publish, false) then now() else published_at end,
    edited_at = case
      -- 지금 게시하는 글은 수정된 적이 없다.
      when published_at is null then null
      when content_changed then now()
      else edited_at
    end
  where id = p_post_id;
  return p_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_notification_delivery (
  p_delivery_id uuid,
  p_lease_id    uuid,
  p_outcome     text,
  p_status_code integer DEFAULT NULL::integer,
  p_error_code  text    DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target private.notification_delivery_outbox;
begin
  if p_outcome not in ('sent', 'suppressed', 'retry', 'dead', 'gone') then
    raise exception 'invalid notification delivery outcome' using errcode = '22023';
  end if;
  select delivery.* into target
  from private.notification_delivery_outbox as delivery
  where delivery.id = p_delivery_id and delivery.status = 'leased'
    and delivery.lease_id = p_lease_id
  for update;
  if target.id is null then return false; end if;

  insert into private.notification_delivery_attempts (
    delivery_id, outcome, status_code, error_code
  ) values (target.id, p_outcome, p_status_code, left(p_error_code, 80));

  if p_outcome = 'gone' then
    delete from private.web_push_subscriptions where id = target.subscription_id;
    return true;
  elsif p_outcome = 'retry' and target.attempt_count < 5 then
    update private.notification_delivery_outbox
    set status = 'pending', lease_id = null, lease_expires_at = null,
      available_at = now() + make_interval(secs => least(3600, 15 * (2 ^ target.attempt_count)::integer)),
      last_status_code = p_status_code, last_error_code = left(p_error_code, 80)
    where id = target.id;
  else
    update private.notification_delivery_outbox
    set status = case
        when p_outcome = 'sent' then 'sent'::private.notification_delivery_status
        when p_outcome = 'suppressed' then 'suppressed'::private.notification_delivery_status
        else 'dead'::private.notification_delivery_status
      end,
      lease_id = null, lease_expires_at = null, completed_at = now(),
      last_status_code = p_status_code, last_error_code = left(p_error_code, 80)
    where id = target.id;
  end if;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_storage_cleanup (
  p_lease_id    uuid,
  p_ids         uuid[],
  p_removed_ids uuid[] DEFAULT '{}'::uuid[],
  p_error       text   DEFAULT NULL::text
)
  RETURNS integer
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  select private.complete_storage_cleanup(p_lease_id, p_ids, p_removed_ids, p_error);
$function$;

CREATE OR REPLACE FUNCTION public.create_group_category (
  p_group_id uuid,
  p_name     text,
  p_position integer DEFAULT NULL::integer
)
  RETURNS public.group_categories
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  created_category public.group_categories;
  chosen_position integer;
begin
  caller_profile_id := private.current_profile_id();
  if auth.uid() is null or caller_profile_id is null or not exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = caller_profile_id
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  select coalesce(
    p_position,
    coalesce(max(category.position) + 1, 0)
  )
  into chosen_position
  from public.group_categories as category
  where category.group_id = p_group_id;

  insert into public.group_categories (group_id, name, position)
  values (p_group_id, btrim(p_name), chosen_position)
  returning * into created_category;
  return created_category;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_group_post_upload_draft (
  p_group_id        uuid,
  p_author_identity public.post_identity
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
  created_post_id uuid;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_author_identity is null then
    raise exception 'author identity is required' using errcode = '22023';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.lock_group_anonymous_activity_target(p_group_id, caller_profile_id);
  end if;

  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = p_group_id and group_data.deleted_at is null
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if group_posting_policy = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'group posting is restricted to staff' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' and group_identity_policy = 'identified' then
    raise exception 'anonymous posting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.assert_group_anonymous_activity_allowed(p_group_id, caller_profile_id);
  end if;
  if p_author_identity = 'staff' and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;

  insert into public.posts (
    kind, body, group_id, title, author_identity, display_author_profile_id
  ) values (
    'group', '', p_group_id, '[private upload draft]', p_author_identity,
    case when p_author_identity = 'identified' then caller_profile_id end
  ) returning id into created_post_id;
  insert into private.post_authors (post_id, profile_id)
  values (created_post_id, caller_profile_id);
  return created_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_group_post (
  p_group_id        uuid,
  p_title           text,
  p_body            text,
  p_author_identity public.post_identity,
  p_category_id     uuid                 DEFAULT NULL::uuid,
  p_publish         boolean              DEFAULT true
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
  created_post_id uuid;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.lock_group_anonymous_activity_target(
      p_group_id, caller_profile_id
    );
  end if;
  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = p_group_id
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if group_posting_policy = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'group posting is restricted to staff' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' and group_identity_policy = 'identified' then
    raise exception 'anonymous posting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.assert_group_anonymous_activity_allowed(
      p_group_id, caller_profile_id
    );
  end if;
  if p_author_identity = 'staff' and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 100 then
    raise exception 'title must contain between 1 and 100 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(p_body, '')) > 20000 then
    raise exception 'body must contain between 0 and 20000 characters' using errcode = '22023';
  end if;
  if coalesce(p_publish, true) and nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'published post requires a body or ready attachment' using errcode = '22023';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.group_categories as category
    where category.id = p_category_id and category.group_id = p_group_id
  ) then
    raise exception 'category must belong to the group' using errcode = '22023';
  end if;

  insert into public.posts (
    kind, body, group_id, title, category_id, author_identity,
    display_author_profile_id, published_at
  ) values (
    'group', coalesce(p_body, ''), p_group_id, btrim(p_title), p_category_id,
    p_author_identity, case when p_author_identity = 'identified' then caller_profile_id end,
    case when coalesce(p_publish, true) then now() end
  ) returning id into created_post_id;
  insert into private.post_authors (post_id, profile_id)
  values (created_post_id, caller_profile_id);
  return created_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_group (
  p_kind            public.group_kind,
  p_name            text,
  p_description     text                         DEFAULT ''::text,
  p_slug            text                         DEFAULT NULL::text,
  p_join_policy     public.group_join_policy     DEFAULT NULL::public.group_join_policy,
  p_identity_policy public.group_identity_policy DEFAULT 'optional_anonymous'::public.group_identity_policy,
  p_posting_policy  public.group_posting_policy  DEFAULT 'members'::public.group_posting_policy
)
  RETURNS TABLE (
    group_id uuid,
    slug     text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile public.profiles;
  chosen_policy public.group_join_policy;
  chosen_slug text;
  created_group_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if caller_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_kind = 'official'
    and (caller_profile.role <> 'admin' or caller_profile.type = 'teacher') then
    raise exception 'official group creation is not allowed' using errcode = '42501';
  end if;

  chosen_policy := coalesce(
    p_join_policy,
    case
      when p_kind = 'official' then 'open'::public.group_join_policy
      else 'invite_only'::public.group_join_policy
    end
  );

  if chosen_policy = 'invite_only' and nullif(btrim(p_slug), '') is not null then
    raise exception 'invite-only groups cannot use a custom slug' using errcode = '22023';
  end if;

  if chosen_policy = 'invite_only' or nullif(btrim(p_slug), '') is null then
    chosen_slug := encode(extensions.gen_random_bytes(7), 'hex');
  else
    chosen_slug := lower(btrim(p_slug));
  end if;

  insert into public.groups (
    id, slug, slug_is_custom, kind, name, description, join_policy,
    identity_policy, posting_policy, created_by
  ) values (
    created_group_id,
    chosen_slug,
    chosen_policy <> 'invite_only' and nullif(btrim(p_slug), '') is not null,
    p_kind,
    btrim(p_name),
    btrim(coalesce(p_description, '')),
    chosen_policy,
    p_identity_policy,
    p_posting_policy,
    caller_profile.id
  );

  return query select created_group_id, chosen_slug;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_post_comment (
  p_post_id           uuid,
  p_body              text,
  p_author_identity   public.post_identity,
  p_parent_comment_id uuid                 DEFAULT NULL::uuid,
  p_image_id          uuid                 DEFAULT NULL::uuid
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
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  context record;
  parent_record public.post_comments;
  image_record public.comment_images;
  post_author_profile_id bigint;
  new_comment_id uuid := gen_random_uuid();
  new_depth smallint := 0;
  new_root_id uuid;
  new_alias smallint;
  target_group_id uuid;
  trimmed_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' then
    select post.group_id into target_group_id
    from public.posts as post
    where post.id = p_post_id and post.kind = 'group';
    if target_group_id is not null then
      perform private.lock_group_anonymous_activity_target(
        target_group_id, caller_profile_id
      );
    end if;
  end if;
  perform 1
  from public.posts as post
  join public.groups as group_data on group_data.id = post.group_id
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where post.id = p_post_id and post.kind = 'group'
  for share of group_data, membership;
  perform 1
  from public.posts as post
  where post.id = p_post_id
    and post.published_at is not null
  for update;
  if not found then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  context := private.comment_post_context(p_post_id, caller_profile_id);
  if context.post_kind is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if not context.is_visible then
    raise exception 'post is not accessible' using errcode = '42501';
  end if;
  if context.post_kind = 'profile' then
    if p_author_identity <> 'identified' then
      raise exception 'profile post comments must be identified' using errcode = '42501';
    end if;
  else
    if p_author_identity = 'anonymous' and context.identity_policy = 'identified' then
      raise exception 'anonymous commenting is not allowed' using errcode = '42501';
    end if;
    if p_author_identity = 'anonymous' then
      perform private.assert_group_anonymous_activity_allowed(
        target_group_id, caller_profile_id
      );
    end if;
    if p_author_identity = 'staff'
      and context.caller_role not in ('owner', 'admin', 'manager') then
      raise exception 'staff identity is not allowed' using errcode = '42501';
    end if;
  end if;
  if char_length(trimmed_body) > 5000 then
    raise exception 'comment must contain between 1 and 5000 characters' using errcode = '22023';
  end if;
  if trimmed_body = '' and p_image_id is null then
    raise exception 'comment requires a body or finalized image' using errcode = '22023';
  end if;
  if p_parent_comment_id is not null then
    select parent.* into parent_record
    from public.post_comments as parent
    where parent.id = p_parent_comment_id and parent.deleted_at is null
    for update;
    if parent_record.id is null then
      raise exception 'parent comment not found' using errcode = 'P0002';
    end if;
    if parent_record.post_id <> p_post_id then
      raise exception 'parent comment must belong to the post' using errcode = '22023';
    end if;
    if parent_record.depth >= 10 then
      raise exception 'replies cannot nest deeper than 10 levels' using errcode = '22023';
    end if;
    new_depth := (parent_record.depth + 1)::smallint;
    new_root_id := parent_record.root_comment_id;
  else
    new_root_id := new_comment_id;
  end if;
  if p_image_id is not null then
    select image.* into image_record
    from public.comment_images as image
    where image.id = p_image_id
    for update;
    if image_record.id is null or image_record.post_id <> p_post_id
      or image_record.status <> 'finalized' or image_record.comment_id is not null
      or not private.is_comment_image_uploader(p_image_id) then
      raise exception 'finalized comment image is not claimable' using errcode = '42501';
    end if;
  end if;
  if p_author_identity = 'anonymous' then
    select author.profile_id into post_author_profile_id
    from private.post_authors as author
    where author.post_id = p_post_id;
    if context.post_author_identity = 'anonymous'
      and post_author_profile_id = caller_profile_id then
      new_alias := 0;
    else
      select alias.alias_number into new_alias
      from private.post_anonymous_aliases as alias
      where alias.post_id = p_post_id and alias.profile_id = caller_profile_id;
      if new_alias is null then
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(p_post_id::text, 0)
        );
        select alias.alias_number into new_alias
        from private.post_anonymous_aliases as alias
        where alias.post_id = p_post_id and alias.profile_id = caller_profile_id;
        if new_alias is null then
          select coalesce(max(alias.alias_number), 0) + 1 into new_alias
          from private.post_anonymous_aliases as alias
          where alias.post_id = p_post_id;
          insert into private.post_anonymous_aliases (post_id, profile_id, alias_number)
          values (p_post_id, caller_profile_id, new_alias);
        end if;
      end if;
    end if;
  end if;

  insert into public.post_comments (
    id, post_id, parent_comment_id, root_comment_id, depth, body,
    author_identity, display_author_profile_id, anon_alias_number
  ) values (
    new_comment_id, p_post_id, p_parent_comment_id, new_root_id, new_depth, trimmed_body,
    p_author_identity, case when p_author_identity = 'identified' then caller_profile_id end,
    new_alias
  );
  insert into private.comment_authors (comment_id, profile_id)
  values (new_comment_id, caller_profile_id);
  if p_image_id is not null then
    update public.comment_images
    set comment_id = new_comment_id, status = 'ready', ready_at = now()
    where id = p_image_id;
  end if;
  return query
  select entry.*
  from private.read_post_comments(
    array[new_comment_id], caller_profile_id, context.caller_role
  ) as entry;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_profile_post (
  p_timeline_pub_id text,
  p_visibility      public.post_visibility DEFAULT 'public'::public.post_visibility
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  timeline_profile public.profiles;
  new_post_id uuid := gen_random_uuid();
  chosen_visibility public.post_visibility;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  -- 타임라인은 화면과 같은 공개 ID로 가리킨다. 클라이언트가 프로필 숫자 ID를 먼저 알아내려고
  -- 왕복하지 않아도 되고, loader가 프로필과 타임라인을 나란히 부를 수 있다.
  --
  -- 타인 작성 허용 값을 읽고 게시물을 넣는 사이에 당사자가 설정을 끄는 창을 없앤다
  -- (STORAGE_BUCKETS.md: 타인 게시물 생성은 하나의 원자적 작업에서 다시 확인한다).
  select profile.* into timeline_profile
  from public.profiles as profile
  where profile.pub_id = lower(btrim(p_timeline_pub_id))
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;
  if timeline_profile.id is null then
    raise exception 'timeline owner not found' using errcode = 'P0002';
  end if;

  if timeline_profile.id = caller_profile_id then
    chosen_visibility := coalesce(p_visibility, 'public');
  else
    if not timeline_profile.allow_timeline_posts then
      raise exception 'timeline owner does not accept posts' using errcode = '42501';
    end if;
    -- 다른 사용자의 타임라인에 작성한 게시물은 즉시 전체 공개다(기능 명세 §8.4).
    chosen_visibility := 'public';
  end if;

  insert into public.posts (
    id, kind, body, timeline_profile_id, author_identity,
    display_author_profile_id, visibility
  ) values (
    new_post_id, 'profile', '', timeline_profile.id, 'identified',
    caller_profile_id, chosen_visibility
  );

  insert into private.post_authors (post_id, profile_id)
  values (new_post_id, caller_profile_id);

  return new_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_group_category (
  p_category_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  category_record public.group_categories;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;

  select category.* into category_record
  from public.group_categories as category
  where category.id = p_category_id
  for update;

  if category_record.id is null then
    raise exception 'category not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.group_memberships as membership
    where membership.group_id = category_record.group_id
      and membership.profile_id = caller_profile_id
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;

  delete from public.group_categories where id = p_category_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_group_post (
  p_post_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  caller_role public.group_member_role;
  author_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
  for update;
  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = post_record.group_id
    and membership.profile_id = caller_profile_id;
  if post_record.id is null or caller_role is null then
    raise exception 'post not found or not accessible' using errcode = '42501';
  end if;
  if caller_role not in ('owner', 'admin') and not private.is_post_author(p_post_id) then
    raise exception 'post deletion is not allowed' using errcode = '42501';
  end if;
  select author.profile_id into author_profile_id
  from private.post_authors as author where author.post_id = p_post_id;
  perform private.purge_posts(array[p_post_id]);
  if caller_profile_id <> author_profile_id then
    -- 어느 글이 사라졌는지 제목으로 말해준다. 삭제된 게시물은 열어볼 수 없으므로 알림이
    -- 대상을 밝히지 않으면 작성자는 무엇이 지워졌는지 영영 알 수 없다. 제목은 작성자
    -- 본인이 쓴 값이고 새 그룹 게시물 알림이 이미 같은 값을 그대로 싣는다. 본문은 싣지
    -- 않는다 -- 알림 제목은 잠금 화면 Push 본문이 되므로 원문이 나가서는 안 된다.
    perform private.emit_notification(
      'post-moderated:' || p_post_id::text,
      author_profile_id, 'post_moderated', 'high', 'moderation', 'staff',
      caller_profile_id, '운영진', null,
      '“' || post_record.title || '” 게시물이 운영자에 의해 삭제되었습니다.',
      post_record.group_id
    );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_group (
  p_group_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_group public.groups;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  select group_record.* into target_group
  from public.groups as group_record
  where group_record.id = p_group_id and group_record.deleted_at is null
  for update;
  if target_group.id is null then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  -- 공식 그룹은 일반 그룹 운영 권한과 분리한다. 앱 관리자는 소유자·멤버십과 무관하게 학교
  -- 공간을 정리할 수 있지만, 비공식 그룹은 계속 소유자만 지운다.
  if target_group.kind = 'official' then
    perform private.require_app_admin();
  elsif not exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = caller_profile_id
      and membership.role = 'owner'
  ) then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  update public.groups
  set deleted_at = now(), icon_path = null, cover_path = null
  where id = p_group_id;

  -- 저장소를 돌려받는다. 청소 워커가 집어 갈 수 있게 tombstone만 찍고 객체는 건드리지 않는다.
  update public.group_media_objects
  set status = 'deleted', deleted_at = now()
  where group_id = p_group_id and status <> 'deleted';

  -- 그룹의 게시물은 첨부·댓글·반응과 함께 즉시 사라진다(삭제 및 보존 정책 §5.2).
  perform private.purge_posts(array(
    select post.id from public.posts as post where post.group_id = p_group_id
  ));

  delete from public.group_join_requests where group_id = p_group_id;
  delete from public.group_memberships where group_id = p_group_id;
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
    update public.post_attachments
    set status = 'deleted', deleted_at = now()
    where id = p_attachment_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_post_comment (
  p_comment_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  comment_record public.post_comments;
  target_post_id uuid;
  comment_group_id uuid;
  comment_post_title text;
  caller_role public.group_member_role;
  author_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select comment.post_id into target_post_id
  from public.post_comments as comment
  where comment.id = p_comment_id;
  if target_post_id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.posts as post
  where post.id = target_post_id
  for update;

  select comment.* into comment_record
  from public.post_comments as comment
  where comment.id = p_comment_id
    and comment.post_id = target_post_id
    and comment.deleted_at is null
  for update;
  if comment_record.id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  select post.group_id, post.title into comment_group_id, comment_post_title
  from public.posts as post
  where post.id = comment_record.post_id;

  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = comment_group_id
    and membership.profile_id = caller_profile_id;

  if not exists (
    select 1 from private.comment_authors as author
    where author.comment_id = p_comment_id and author.profile_id = caller_profile_id
  ) and coalesce(caller_role, 'member') not in ('owner', 'admin') then
    raise exception 'only the author or a group moderator can delete a comment'
      using errcode = '42501';
  end if;
  if exists (
    select 1
    from private.feed_bump_events as bump
    where bump.comment_id = p_comment_id
  ) then
    raise exception 'effective #업 comments cannot be deleted' using errcode = '22023';
  end if;

  select author.profile_id into author_profile_id
  from private.comment_authors as author where author.comment_id = p_comment_id;

  if comment_record.depth = 0 then
    -- 최상위 댓글을 지우면 답글 묶음 전체가 사라진다(기능 명세 §9.4).
    perform 1
    from public.post_comments as comment
    where comment.root_comment_id = p_comment_id
      and comment.deleted_at is null
    order by comment.id
    for update;

    update public.post_comments as comment
    set deleted_at = now()
    where comment.root_comment_id = p_comment_id and comment.deleted_at is null;
  else
    update public.post_comments as comment
    set deleted_at = now()
    where comment.id = p_comment_id;
  end if;
  if caller_profile_id <> author_profile_id then
    -- 댓글 원문은 싣지 않는다(기능 명세 §14.8). 대신 댓글이 달려 있던 게시물의 제목으로
    -- 어느 댓글이었는지 짚어준다. 제목은 원문이 아니고 작성자가 이미 읽을 수 있던 값이다.
    -- 프로필 타임라인 글은 제목이 없어서 예전 문장으로 떨어진다.
    perform private.emit_notification(
      'comment-moderated:' || p_comment_id::text,
      author_profile_id, 'comment_moderated', 'high', 'moderation', 'staff',
      caller_profile_id, '운영진', null,
      case when comment_post_title is null
        then '댓글이 운영자에 의해 삭제되었습니다.'
        else '“' || comment_post_title
          || '” 게시물에 남긴 내 댓글이 운영자에 의해 삭제되었습니다.'
      end,
      comment_group_id, target_post_id
    );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_profile_post (
  p_post_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  author_profile_id bigint;
  caller_profile public.profiles;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'profile'
  for update;
  if post_record.id is null then
    raise exception 'post not found or not accessible' using errcode = '42501';
  end if;
  if not private.is_post_author(p_post_id)
    and post_record.timeline_profile_id <> caller_profile_id then
    raise exception 'post deletion is not allowed' using errcode = '42501';
  end if;

  select author.profile_id into author_profile_id
  from private.post_authors as author where author.post_id = p_post_id;
  select profile.* into caller_profile
  from public.profiles as profile where profile.id = caller_profile_id;

  perform private.purge_posts(array[p_post_id]);
  if caller_profile_id = post_record.timeline_profile_id
    and caller_profile_id <> author_profile_id then
    perform private.emit_notification(
      'timeline-post-deleted:' || p_post_id::text,
      author_profile_id, 'timeline_post_deleted', 'normal', 'timeline', 'identified',
      caller_profile_id, caller_profile.name, caller_profile.avatar_path,
      '타임라인 게시물이 삭제되었습니다.',
      null, null, null, post_record.timeline_profile_id
    );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.discover_groups (
  p_query              text     DEFAULT ''::text,
  p_include_joined     boolean  DEFAULT false,
  p_after_rank         smallint DEFAULT NULL::smallint,
  p_after_member_count bigint   DEFAULT NULL::bigint,
  p_after_id           uuid     DEFAULT NULL::uuid,
  p_limit              integer  DEFAULT 13
)
  RETURNS TABLE (
    group_id         uuid,
    slug             text,
    name             text,
    description      text,
    join_policy      public.group_join_policy,
    identity_policy  public.group_identity_policy,
    icon_path        text,
    cover_path       text,
    member_count     bigint,
    membership_state text,
    member_role      public.group_member_role,
    requested_at     timestamp with time zone,
    sort_rank        smallint
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile public.profiles;
  normalized_query text := lower(
    regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g')
  );
  cursor_field_count integer := pg_catalog.num_nonnulls(
    p_after_rank,
    p_after_member_count,
    p_after_id
  );
begin
  if cursor_field_count not in (0, 3) then
    raise exception 'all discovery cursor fields are required'
      using errcode = '22023';
  end if;

  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if caller_profile.id is null or caller_profile.type = 'teacher' then
    raise exception 'group discovery is not allowed' using errcode = '42501';
  end if;

  return query
  with ranked_groups as (
    select
      group_record.id as group_id,
      group_record.slug,
      group_record.name,
      group_record.description,
      group_record.join_policy,
      group_record.identity_policy,
      group_record.icon_path,
      group_record.cover_path,
      group_record.member_count,
      case
        when membership.profile_id is not null then 'member'
        when join_request.profile_id is not null then 'requested'
        else 'none'
      end as membership_state,
      membership.role as member_role,
      join_request.requested_at,
      case
        when normalized_query = '' then 0
        when group_record.search_name = normalized_query then 0
        when group_record.search_name like normalized_query || '%' then 1
        else 2
      end::smallint as sort_rank
    from public.groups as group_record
    left join public.group_memberships as membership
      on membership.group_id = group_record.id
      and membership.profile_id = caller_profile.id
    left join public.group_join_requests as join_request
      on join_request.group_id = group_record.id
      and join_request.profile_id = caller_profile.id
    where group_record.kind = 'unofficial'
      and group_record.join_policy <> 'invite_only'
      and (p_include_joined or membership.profile_id is null)
      and (
        normalized_query = ''
        or group_record.search_name like '%' || normalized_query || '%'
      )
  )
  select ranked_group.*
  from ranked_groups as ranked_group
  where p_after_rank is null
    or ranked_group.sort_rank > p_after_rank
    or (
      ranked_group.sort_rank = p_after_rank
      and ranked_group.member_count < p_after_member_count
    )
    or (
      ranked_group.sort_rank = p_after_rank
      and ranked_group.member_count = p_after_member_count
      and ranked_group.group_id > p_after_id
    )
  order by
    ranked_group.sort_rank,
    ranked_group.member_count desc,
    ranked_group.group_id
  limit least(greatest(coalesce(p_limit, 13), 1), 50);
end;
$function$;

CREATE OR REPLACE FUNCTION public.dismiss_group_post_reports (
  p_post_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  caller_role public.group_member_role;
  post_group_id uuid;
begin
  caller_profile_id := private.current_profile_id();

  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select post.group_id
  into post_group_id
  from public.posts as post
  where post.id = p_post_id
    and post.kind = 'group'
    and post.published_at is not null;

  if post_group_id is null then
    raise exception 'post not found'
      using errcode = 'P0002';
  end if;

  select membership.role
  into caller_role
  from public.group_memberships as membership
  where membership.group_id = post_group_id
    and membership.profile_id = caller_profile_id;

  -- 매니저는 신고를 조회만 한다(기능 명세 §8.15). 무시는 삭제와 같은 권한 경계에 둔다.
  if caller_role is null
    or caller_role not in ('owner', 'admin')
  then
    raise exception 'report dismissal is not allowed'
      using errcode = '42501';
  end if;

  insert into private.group_post_report_dismissals (
    post_id,
    dismissed_by_profile_id,
    dismissed_at
  )
  values (
    p_post_id,
    caller_profile_id,
    now()
  )
  on conflict (post_id) do update
  set
    dismissed_by_profile_id = excluded.dismissed_by_profile_id,
    dismissed_at = excluded.dismissed_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_comment_image (
  p_image_id uuid
)
  RETURNS public.comment_images
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  image public.comment_images;
  object_record storage.objects;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select item.* into image
  from public.comment_images as item
  where item.id = p_image_id
  for update;
  if image.id is null or not private.is_comment_image_uploader(p_image_id) then
    raise exception 'only the uploader can finalize a comment image' using errcode = '42501';
  end if;
  if image.status <> 'pending' then
    raise exception 'comment image is not pending' using errcode = '55000';
  end if;
  if not private.can_read_post(image.post_id) then
    raise exception 'post is not accessible' using errcode = '42501';
  end if;

  select object.* into object_record
  from storage.objects as object
  where object.bucket_id = image.storage_bucket
    and object.name = image.object_path;
  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from auth.uid()::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from image.size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from image.mime_type then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;

  update public.comment_images
  set status = 'finalized', finalized_at = now()
  where id = p_image_id
  returning * into image;
  return image;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_group_media (
  p_media_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  media public.group_media_objects;
  object_record storage.objects;
  previous_path text;
begin
  select item.* into media
  from public.group_media_objects as item
  where item.id = p_media_id
  for update;

  if media.id is null or not private.can_manage_group(media.group_id) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;
  if media.status <> 'pending' then
    raise exception 'group media is not pending' using errcode = '55000';
  end if;

  select object.* into object_record
  from storage.objects as object
  where object.bucket_id = 'group-media'
    and object.name = media.object_path;

  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from auth.uid()::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from media.size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from 'image/webp' then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;

  if media.slot = 'icon' then
    select icon_path into previous_path from public.groups where id = media.group_id for update;
    update public.groups set icon_path = media.object_path where id = media.group_id;
  else
    select cover_path into previous_path from public.groups where id = media.group_id for update;
    update public.groups set cover_path = media.object_path where id = media.group_id;
  end if;

  update public.group_media_objects
  set status = 'ready', ready_at = now()
  where id = media.id;

  if previous_path is not null and previous_path <> media.object_path then
    update public.group_media_objects
    set status = 'deleted', deleted_at = now()
    where object_path = previous_path and status = 'ready';
  end if;

  return media.object_path;
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

CREATE OR REPLACE FUNCTION public.finalize_profile_media (
  p_media_id uuid
)
  RETURNS public.profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  media public.profile_media_objects;
  object_record storage.objects;
  current_profile public.profiles;
  updated_profile public.profiles;
  activity_post_id uuid := gen_random_uuid();
  activity_kind public.profile_media_activity_kind;
begin
  select item.* into media
  from public.profile_media_objects as item
  where item.id = p_media_id
  for update;

  if media.id is null or media.auth_user_id is distinct from caller_id then
    raise exception 'profile media owner required' using errcode = '42501';
  end if;
  if media.status <> 'pending' then
    raise exception 'profile media is not pending' using errcode = '55000';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.id = media.profile_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;

  if current_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select object.* into object_record
  from storage.objects as object
  where object.bucket_id = 'profile-media'
    and object.name = media.object_path;

  if object_record.id is null then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;
  if object_record.owner_id is distinct from caller_id::text then
    raise exception 'uploaded object owner does not match' using errcode = '42501';
  end if;
  if nullif(object_record.metadata ->> 'size', '')::bigint is distinct from media.size_bytes
    or object_record.metadata ->> 'mimetype' is distinct from 'image/webp' then
    raise exception 'uploaded object metadata does not match' using errcode = '22023';
  end if;

  update public.profile_media_objects
  set status = 'ready', ready_at = now()
  where id = media.id;

  if media.slot = 'avatar' then
    activity_kind := 'avatar_changed';
    update public.profiles
    set avatar_path = media.object_path
    where id = current_profile.id
    returning * into updated_profile;
  else
    activity_kind := 'cover_changed';
    update public.profiles
    set cover_path = media.object_path
    where id = current_profile.id
    returning * into updated_profile;
  end if;

  insert into public.posts (
    id,
    kind,
    body,
    timeline_profile_id,
    author_identity,
    display_author_profile_id,
    visibility,
    published_at,
    activity_kind,
    activity_media_path
  ) values (
    activity_post_id,
    'profile',
    '',
    current_profile.id,
    'identified',
    current_profile.id,
    'public',
    now(),
    activity_kind,
    media.object_path
  );

  insert into private.post_authors (post_id, profile_id)
  values (activity_post_id, current_profile.id);

  return updated_profile;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_accepted_profile (
  p_pub_id text
)
  RETURNS TABLE (
    id                   bigint,
    pub_id               text,
    name                 text,
    role                 public.app_role,
    type                 public.profile_type,
    student_number       text,
    class_no             smallint,
    cohort               smallint,
    gender               public.profile_gender,
    academic_track       public.profile_academic_track,
    phone_number         text,
    avatar_path          text,
    birthday             date,
    description          text,
    dorm_room            smallint,
    allow_timeline_posts boolean,
    cover_path           text,
    contact_email        text,
    department           text,
    is_returning_student boolean
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select
    target.id, target.pub_id, target.name, target.role, target.type,
    target.student_number, target.class_no, target.cohort, target.gender,
    target.academic_track, target.phone_number, target.avatar_path,
    target.birthday, target.description, target.dorm_room,
    target.allow_timeline_posts, target.cover_path, target.contact_email,
    target.department, target.is_returning_student
  from public.profiles as target
  where lower(target.pub_id) = lower(btrim(p_pub_id))
    and target.status = 'accepted'
    and target.deleted_at is null
    and exists (
      select 1
      from public.profiles as viewer
      where viewer.auth_user_id = auth.uid()
        and viewer.status = 'accepted'
        and viewer.deleted_at is null
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_group_invite_preview (
  p_token text
)
  RETURNS TABLE (
    group_id        uuid,
    slug            text,
    name            text,
    description     text,
    join_policy     public.group_join_policy,
    identity_policy public.group_identity_policy,
    posting_policy  public.group_posting_policy,
    member_count    bigint,
    expires_at      timestamp with time zone,
    already_member  boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  return query
  select
    group_record.id,
    group_record.slug,
    group_record.name,
    group_record.description,
    group_record.join_policy,
    group_record.identity_policy,
    group_record.posting_policy,
    group_record.member_count,
    invite.expires_at,
    exists (
      select 1
      from public.group_memberships as membership
      where membership.group_id = group_record.id
        and membership.profile_id = caller_profile_id
    )
  from private.group_invites as invite
  join public.groups as group_record on group_record.id = invite.group_id
  where invite.token = p_token
    and invite.expires_at > now()
    and group_record.kind = 'unofficial'
    and group_record.deleted_at is null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_group_invite (
  p_group_id uuid
)
  RETURNS TABLE (
    token      text,
    expires_at timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.assert_group_invite_manager(p_group_id);

  return query
  select invite.token, invite.expires_at
  from private.group_invites as invite
  where invite.group_id = p_group_id
    and invite.expires_at > now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_group_post (
  p_post_id uuid
)
  RETURNS TABLE (
    post_id                                 uuid,
    group_id                                uuid,
    category_id                             uuid,
    category_name                           text,
    title                                   text,
    body                                    text,
    author_identity                         public.post_identity,
    author_pub_id                           text,
    author_name                             text,
    author_avatar_path                      text,
    author_label                            text,
    is_pinned                               boolean,
    published_at                            timestamp with time zone,
    edited_at                               timestamp with time zone,
    comment_count                           integer,
    reaction_count                          integer,
    top_reactions                           public.post_reaction[],
    my_reaction                             public.post_reaction,
    is_author                               boolean,
    can_edit                                boolean,
    can_delete                              boolean,
    can_pin                                 boolean,
    can_moderate_anonymous                  boolean,
    anonymous_author_restricted             boolean,
    anonymous_author_restriction_expires_at timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_group_id uuid;
  caller_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.group_id into post_group_id
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
    and post.published_at is not null;
  if post_group_id is null then
    return;
  end if;
  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = post_group_id
    and membership.profile_id = caller_profile_id;
  if caller_role is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select
    post.id, post.group_id, post.category_id, category.name,
    post.title, post.body, post.author_identity,
    case when post.author_identity in ('identified', 'staff') then profile.pub_id end,
    case when post.author_identity in ('identified', 'staff') then profile.name end,
    case when post.author_identity in ('identified', 'staff') then profile.avatar_path end,
    case post.author_identity
      when 'identified' then profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    post.pinned_at is not null, post.published_at, post.edited_at,
    post.comment_count,
    summary.total,
    summary.top,
    mine.reaction,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id or caller_role in ('owner', 'admin'),
    caller_role in ('owner', 'admin', 'manager'),
    post.author_identity = 'anonymous' and author.profile_id <> caller_profile_id
      and caller_role in ('owner', 'admin'),
    active_restriction.expires_at is not null,
    active_restriction.expires_at
  from public.posts as post
  join private.post_authors as author on author.post_id = post.id
  left join public.group_categories as category on category.id = post.category_id
  left join public.profiles as profile
    on (
      (post.author_identity = 'identified' and profile.id = post.display_author_profile_id)
      or (post.author_identity = 'staff' and profile.id = author.profile_id)
    )
    and profile.status = 'accepted'
    and profile.deleted_at is null
  left join public.post_reactions as mine
    on mine.post_id = post.id and mine.profile_id = caller_profile_id
  left join lateral (
    select restriction.expires_at
    from private.group_anonymous_activity_restrictions as restriction
    where restriction.group_id = post.group_id
      and restriction.profile_id = author.profile_id
      and restriction.ended_at is null
      and restriction.expires_at > now()
    order by restriction.created_at desc, restriction.id desc
    limit 1
  ) as active_restriction on post.author_identity = 'anonymous'
    and author.profile_id <> caller_profile_id
    and caller_role in ('owner', 'admin')
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
      from public.post_reactions as entry
      where entry.post_id = post.id
      group by entry.reaction
    ) as tally
  ) as summary on true
  where post.id = p_post_id and post.kind = 'group'
    and post.published_at is not null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_group_anonymous_activity_restriction (
  p_group_id uuid
)
  RETURNS TABLE (
    reason     text,
    expires_at timestamp with time zone
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
  return query
  select restriction.reason, restriction.expires_at
  from private.group_anonymous_activity_restrictions as restriction
  where restriction.group_id = p_group_id and restriction.profile_id = caller_profile_id
    and restriction.ended_at is null and restriction.expires_at > now()
  order by restriction.created_at desc, restriction.id desc limit 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_notification_preferences()
  RETURNS TABLE (
    content_push_enabled  boolean,
    timeline_push_enabled boolean,
    group_push_enabled    boolean,
    account_push_enabled  boolean,
    school_push_enabled   boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  insert into public.notification_preferences (profile_id)
  values (caller_profile_id)
  on conflict do nothing;
  return query
  select preference.content_push_enabled, preference.timeline_push_enabled,
    preference.group_push_enabled, preference.account_push_enabled,
    preference.school_push_enabled
  from public.notification_preferences as preference
  where preference.profile_id = caller_profile_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_profile()
  RETURNS SETOF public.profiles
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select profile.*
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.deleted_at is null;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_recent_unread_notification_count()
  RETURNS bigint
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  return (
    select count(*)
    from public.notifications as notification
    where notification.recipient_profile_id = private.current_profile_id()
      and notification.read_at is null
      and notification.last_activity_at > now() - interval '24 hours'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_web_push_status (
  p_endpoint text
)
  RETURNS TABLE (
    subscribed boolean
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
  return query select exists (
    select 1 from private.web_push_subscriptions as subscription
    where subscription.endpoint = p_endpoint
      and subscription.profile_id = private.current_profile_id()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_profile_post (
  p_post_id uuid
)
  RETURNS TABLE (
    post_id             uuid,
    body                text,
    timeline_pub_id     text,
    timeline_name       text,
    author_pub_id       text,
    author_name         text,
    author_avatar_path  text,
    activity_kind       public.profile_media_activity_kind,
    activity_media_path text,
    visibility          public.post_visibility,
    published_at        timestamp with time zone,
    edited_at           timestamp with time zone,
    comment_count       integer,
    reaction_count      integer,
    top_reactions       public.post_reaction[],
    my_reaction         public.post_reaction,
    is_author           boolean,
    can_edit            boolean,
    can_delete          boolean
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
  if not exists (
    select 1 from public.posts as post
    where post.id = p_post_id and post.kind = 'profile'
      and post.published_at is not null
  ) or not private.can_read_post(p_post_id) then
    return;
  end if;

  return query
  select entry.*
  from private.read_profile_posts(array[p_post_id], caller_profile_id) as entry;
end;
$function$;

CREATE OR REPLACE FUNCTION public.issue_group_invite (
  p_group_id uuid,
  p_hours    integer DEFAULT 24
)
  RETURNS TABLE (
    token      text,
    expires_at timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  new_token text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  perform private.assert_group_invite_manager(p_group_id);

  if p_hours is null or p_hours < 1 or p_hours > 336 then
    raise exception 'invite lifetime must be between 1 and 336 hours'
      using errcode = '22023';
  end if;

  return query
  insert into private.group_invites as invite (
    group_id, token, created_by, created_at, expires_at
  )
  values (
    p_group_id,
    new_token,
    private.current_profile_id(),
    now(),
    now() + make_interval(hours => p_hours)
  )
  on conflict (group_id) do update
  set token = excluded.token,
    created_by = excluded.created_by,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at
  returning invite.token, invite.expires_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_birthdays (
  p_reference_date date,
  p_scope          text DEFAULT 'month'::text
)
  RETURNS TABLE (
    pub_id         text,
    name           text,
    avatar_path    text,
    birthday_month smallint,
    birthday_day   smallint,
    birthday_date  date
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  range_start date;
  range_end date;
  current_cohort smallint;
begin
  if p_reference_date is null then
    raise exception 'reference date is required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles as viewer
    where viewer.auth_user_id = auth.uid()
      and viewer.status = 'accepted'
      and viewer.deleted_at is null
  ) then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_scope = 'today' then
    range_start := p_reference_date;
    range_end := p_reference_date;
  elsif p_scope = 'month' then
    range_start := (p_reference_date - interval '1 month')::date;
    range_end := (p_reference_date + interval '1 month')::date;
  else
    raise exception 'birthday scope must be today or month' using errcode = '22023';
  end if;

  current_cohort := (extract(year from p_reference_date)::integer - 1995)::smallint;

  return query
  with eligible_profiles as (
    select profile.pub_id, profile.name, profile.avatar_path, profile.birthday
    from public.profiles as profile
    where profile.status = 'accepted'
      and profile.deleted_at is null
      and profile.birthday is not null
      and (
        profile.type = 'teacher'
        or (
          profile.type = 'student'
          and (
            (
              profile.is_returning_student
              and profile.cohort = current_cohort - 3
            )
            or (
              not profile.is_returning_student
              and profile.cohort between current_cohort - 2 and current_cohort
            )
          )
        )
      )
  ), anniversaries as (
    select
      profile.pub_id,
      profile.name,
      profile.avatar_path,
      extract(month from profile.birthday)::smallint as birthday_month,
      extract(day from profile.birthday)::smallint as birthday_day,
      make_date(
        calendar_year.value,
        extract(month from profile.birthday)::integer,
        least(
          extract(day from profile.birthday)::integer,
          extract(
            day from (
              make_date(
                calendar_year.value,
                extract(month from profile.birthday)::integer,
                1
              ) + interval '1 month - 1 day'
            )
          )::integer
        )
      ) as birthday_date
    from eligible_profiles as profile
    cross join lateral generate_series(
      extract(year from range_start)::integer,
      extract(year from range_end)::integer
    ) as calendar_year(value)
  )
  select
    anniversary.pub_id,
    anniversary.name,
    anniversary.avatar_path,
    anniversary.birthday_month,
    anniversary.birthday_day,
    anniversary.birthday_date
  from anniversaries as anniversary
  where anniversary.birthday_date between range_start and range_end
  order by anniversary.birthday_date, anniversary.name, anniversary.pub_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_comment_images (
  p_comment_ids uuid[]
)
  RETURNS TABLE (
    image_id       uuid,
    comment_id     uuid,
    post_id        uuid,
    storage_bucket text,
    object_path    text,
    mime_type      text,
    size_bytes     bigint,
    width          integer,
    height         integer,
    ready_at       timestamp with time zone
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
  if p_comment_ids is null or cardinality(p_comment_ids) > 500 then
    raise exception 'invalid comment image batch' using errcode = '22023';
  end if;

  return query
  select image.id, image.comment_id, image.post_id, image.storage_bucket,
    image.object_path, image.mime_type, image.size_bytes, image.width,
    image.height, image.ready_at
  from public.comment_images as image
  join public.post_comments as comment on comment.id = image.comment_id
  where image.comment_id = any(p_comment_ids)
    and image.status = 'ready'
    and comment.deleted_at is null
    and private.can_read_post(image.post_id)
  order by image.comment_id, image.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_comment_reactors (
  p_comment_id uuid
)
  RETURNS TABLE (
    reaction            public.post_reaction,
    reactor_pub_id      text,
    reactor_name        text,
    reactor_avatar_path text,
    reacted_at          timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_post_id uuid;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select comment.post_id into target_post_id
  from public.post_comments as comment
  where comment.id = p_comment_id and comment.deleted_at is null;
  if target_post_id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;
  perform private.reaction_context(target_post_id, caller_profile_id);
  return query
  select entry.reaction, profile.pub_id, profile.name, profile.avatar_path,
    entry.created_at
  from public.comment_reactions as entry
  left join public.profiles as profile on profile.id = entry.profile_id
    and profile.status = 'accepted' and profile.deleted_at is null
  where entry.comment_id = p_comment_id
  order by entry.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_feed_posts (
  p_page_token uuid DEFAULT NULL::uuid
)
  RETURNS TABLE (
    feed_epoch          timestamp with time zone,
    next_page_token     uuid,
    feed_position       integer,
    rank_time           timestamp with time zone,
    post_id             uuid,
    kind                public.post_kind,
    body                text,
    title               text,
    author_identity     public.post_identity,
    author_pub_id       text,
    author_name         text,
    author_avatar_path  text,
    author_label        text,
    group_id            uuid,
    group_slug          text,
    group_name          text,
    category_name       text,
    is_pinned           boolean,
    timeline_pub_id     text,
    timeline_name       text,
    activity_kind       public.profile_media_activity_kind,
    activity_media_path text,
    visibility          public.post_visibility,
    published_at        timestamp with time zone,
    edited_at           timestamp with time zone,
    comment_count       integer,
    reaction_count      integer,
    top_reactions       public.post_reaction[],
    my_reaction         public.post_reaction,
    attachments         jsonb,
    is_author           boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_session_id uuid;
  target_epoch timestamptz;
  page_after_position integer := 0;
  page_last_position integer;
  following_page_token uuid;
  selected_positions integer[];
  selected_post_ids uuid[];
  selected_rank_times timestamptz[];
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_page_token is null then
    target_session_id := private.create_feed_session(caller_profile_id);
    select session.feed_epoch into target_epoch
    from private.feed_sessions as session
    where session.id = target_session_id;
  else
    select page.session_id, page.after_position, session.feed_epoch
    into target_session_id, page_after_position, target_epoch
    from private.feed_pages as page
    join private.feed_sessions as session on session.id = page.session_id
    where page.token = p_page_token
      and session.profile_id = caller_profile_id
      and session.expires_at > statement_timestamp();

    if target_session_id is null then
      raise exception 'feed page not found or expired' using errcode = '22023';
    end if;
  end if;

  select
    array_agg(page.position order by page.position),
    array_agg(page.post_id order by page.position),
    array_agg(page.rank_time order by page.position)
  into selected_positions, selected_post_ids, selected_rank_times
  from (
    select entry.position, entry.post_id, entry.rank_time
    from private.feed_session_posts as entry
    where entry.session_id = target_session_id
      and entry.position > page_after_position
      and private.can_access_feed_post(entry.post_id, caller_profile_id)
    order by entry.position
    limit 20
  ) as page;

  if cardinality(selected_positions) > 0 then
    page_last_position := selected_positions[cardinality(selected_positions)];
  end if;

  if page_last_position is not null and exists (
    select 1
    from private.feed_session_posts as entry
    where entry.session_id = target_session_id
      and entry.position > page_last_position
      and private.can_access_feed_post(entry.post_id, caller_profile_id)
  ) then
    insert into private.feed_pages (session_id, after_position)
    values (target_session_id, page_last_position)
    on conflict (session_id, after_position) do nothing;

    select page.token into following_page_token
    from private.feed_pages as page
    where page.session_id = target_session_id
      and page.after_position = page_last_position;
  end if;

  return query
  select
    target_epoch,
    following_page_token,
    selected.position,
    selected.rank_time,
    post.id,
    post.kind,
    post.body,
    post.title,
    post.author_identity,
    case when post.author_identity in ('identified', 'staff') then author_profile.pub_id end,
    case when post.author_identity in ('identified', 'staff') then author_profile.name end,
    case when post.author_identity in ('identified', 'staff') then author_profile.avatar_path end,
    case post.author_identity
      when 'identified' then author_profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    post.group_id,
    group_record.slug,
    group_record.name,
    category.name,
    post.pinned_at is not null,
    timeline.pub_id,
    timeline.name,
    post.activity_kind,
    post.activity_media_path,
    post.visibility,
    post.published_at,
    post.edited_at,
    post.comment_count,
    reaction_summary.total,
    reaction_summary.top,
    mine.reaction,
    attachment_summary.items,
    author.profile_id = caller_profile_id
  from unnest(selected_positions, selected_post_ids, selected_rank_times)
    as selected(position, post_id, rank_time)
  join public.posts as post on post.id = selected.post_id
  join private.post_authors as author on author.post_id = post.id
  left join public.profiles as author_profile
    on (
      (post.author_identity = 'identified' and author_profile.id = post.display_author_profile_id)
      or (post.author_identity = 'staff' and author_profile.id = author.profile_id)
    )
    and author_profile.status = 'accepted'
    and author_profile.deleted_at is null
  left join public.groups as group_record on group_record.id = post.group_id
  left join public.group_categories as category on category.id = post.category_id
  left join public.profiles as timeline
    on timeline.id = post.timeline_profile_id
    and timeline.status = 'accepted'
    and timeline.deleted_at is null
  left join public.post_reactions as mine
    on mine.post_id = post.id and mine.profile_id = caller_profile_id
  left join lateral (
    select
      coalesce(sum(tally.n), 0)::integer as total,
      coalesce(
        array_agg(tally.reaction order by tally.n desc, tally.reaction)
          filter (where tally.rank <= 3),
        array[]::public.post_reaction[]
      ) as top
    from (
      select entry.reaction, count(*)::integer as n,
        row_number() over (order by count(*) desc, entry.reaction) as rank
      from public.post_reactions as entry
      where entry.post_id = post.id
      group by entry.reaction
    ) as tally
  ) as reaction_summary on true
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'attachment_id', attachment.id,
          'storage_bucket', attachment.storage_bucket,
          'object_path', attachment.object_path,
          'original_filename', attachment.original_filename,
          'position', attachment.position,
          'mime_type', attachment.mime_type,
          'size_bytes', attachment.size_bytes,
          'width', attachment.width,
          'height', attachment.height
        ) order by attachment.position, attachment.id
      ),
      '[]'::jsonb
    ) as items
    from public.post_attachments as attachment
    where attachment.post_id = post.id and attachment.status = 'ready'
  ) as attachment_summary on true
  order by selected.position;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_group_join_requests (
  p_group_id uuid
)
  RETURNS TABLE (
    request_id           uuid,
    pub_id               text,
    name                 text,
    cohort               smallint,
    is_returning_student boolean,
    avatar_path          text,
    requested_at         timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null or not exists (
    select 1 from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
      and caller_membership.role in ('owner', 'admin')
  ) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  return query
  select join_request.id, profile.pub_id, profile.name, profile.cohort,
    profile.is_returning_student, profile.avatar_path, join_request.requested_at
  from public.group_join_requests as join_request
  join public.profiles as profile on profile.id = join_request.profile_id
  where join_request.group_id = p_group_id
  order by join_request.requested_at, join_request.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_group_members (
  p_group_id            uuid,
  p_query               text                     DEFAULT ''::text,
  p_after_role          public.group_member_role DEFAULT NULL::public.group_member_role,
  p_after_joined_at     timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_after_membership_id uuid                     DEFAULT NULL::uuid,
  p_limit               integer                  DEFAULT 30
)
  RETURNS TABLE (
    membership_id        uuid,
    pub_id               text,
    name                 text,
    cohort               smallint,
    is_returning_student boolean,
    avatar_path          text,
    role                 public.group_member_role,
    joined_at            timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  query_text text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'member page limit must be between 1 and 100' using errcode = '22023';
  end if;
  if (p_after_role is null) <> (p_after_joined_at is null)
    or (p_after_role is null) <> (p_after_membership_id is null) then
    raise exception 'member cursor must be complete' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
  ) then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select membership.id, profile.pub_id, profile.name, profile.cohort,
    profile.is_returning_student, profile.avatar_path, membership.role,
    membership.joined_at
  from public.group_memberships as membership
  join public.profiles as profile on profile.id = membership.profile_id
  where membership.group_id = p_group_id
    and (
      query_text = ''
      -- 명부가 복학생을 n.5기로 보여 주므로 검색도 표시값을 기준으로 한다.
      -- 표시값은 저장된 기수를 접두사로 포함하므로 '20'은 20기와 20.5기를 모두 찾는다.
      or (
        profile.cohort
          + case when profile.is_returning_student then 0.5 else 0 end
      )::text like '%' || query_text || '%'
      or profile.name ilike '%' || query_text || '%'
    )
    and (
      p_after_role is null
      or (membership.role, membership.joined_at, membership.id)
        > (p_after_role, p_after_joined_at, p_after_membership_id)
    )
  order by membership.role, membership.joined_at, membership.id
  limit p_limit;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_group_post_report_descriptions (
  p_group_id          uuid,
  p_post_id           uuid,
  p_before_created_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_before_report_id  bigint                   DEFAULT NULL::bigint,
  p_limit             integer                  DEFAULT 8
)
  RETURNS TABLE (
    report_id   bigint,
    reason      public.group_post_report_reason,
    description text,
    created_at  timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  caller_role public.group_member_role;
begin
  caller_profile_id := private.current_profile_id();

  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select membership.role
  into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id;

  if caller_role is null
    or caller_role not in ('owner', 'admin', 'manager')
  then
    raise exception 'report review is not allowed'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.posts as post
    where post.id = p_post_id
      and post.group_id = p_group_id
      and post.kind = 'group'
  ) then
    raise exception 'post not found'
      using errcode = 'P0002';
  end if;

  return query
  select
    report.id,
    report.reason,
    report.description,
    report.created_at
  from private.group_post_reports as report
  left join private.group_post_report_dismissals as dismissal
    on dismissal.post_id = report.post_id
  where report.post_id = p_post_id
    and report.description is not null
    and (
      dismissal.dismissed_at is null
      or report.created_at > dismissal.dismissed_at
    )
    and (
      p_before_created_at is null
      or (
        p_before_report_id is not null
        and (
          report.created_at,
          report.id
        ) < (
          p_before_created_at,
          p_before_report_id
        )
      )
    )
  order by
    report.created_at desc,
    report.id desc
  limit least(
    greatest(coalesce(p_limit, 8), 1),
    30
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_group_post_report_summaries (
  p_group_id            uuid,
  p_sort                text                     DEFAULT 'count'::text,
  p_cursor_report_count bigint                   DEFAULT NULL::bigint,
  p_cursor_latest_at    timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_cursor_post_id      uuid                     DEFAULT NULL::uuid,
  p_limit               integer                  DEFAULT 20
)
  RETURNS TABLE (
    post_id             uuid,
    title               text,
    body_preview        text,
    author_identity     public.post_identity,
    author_pub_id       text,
    author_name         text,
    author_avatar_path  text,
    author_label        text,
    report_count        bigint,
    dismissed_count     bigint,
    description_count   bigint,
    abuse_count         bigint,
    sexual_count        bigint,
    privacy_count       bigint,
    impersonation_count bigint,
    spam_count          bigint,
    other_count         bigint,
    latest_at           timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  caller_role public.group_member_role;
begin
  caller_profile_id := private.current_profile_id();

  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select membership.role
  into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id;

  if caller_role is null
    or caller_role not in ('owner', 'admin', 'manager')
  then
    raise exception 'report review is not allowed'
      using errcode = '42501';
  end if;

  if p_sort not in ('count', 'recent') then
    raise exception 'invalid report sort'
      using errcode = '22023';
  end if;

  return query
  with scoped as (
    select
      report.post_id,
      report.reason,
      report.description,
      report.created_at,
      dismissal.dismissed_at is not null
        and report.created_at <= dismissal.dismissed_at as dismissed
    from private.group_post_reports as report
    join public.posts as post
      on post.id = report.post_id
    left join private.group_post_report_dismissals as dismissal
      on dismissal.post_id = report.post_id
    where post.group_id = p_group_id
      and post.kind = 'group'
      and post.published_at is not null
  ),
  aggregated as (
    select
      scoped.post_id,
      count(*) filter (
        where not scoped.dismissed
      )::bigint as report_count,
      count(*) filter (
        where scoped.dismissed
      )::bigint as dismissed_count,
      count(scoped.description) filter (
        where not scoped.dismissed
      )::bigint as description_count,
      count(*) filter (
        where not scoped.dismissed
          and scoped.reason = 'abuse'
      )::bigint as abuse_count,
      count(*) filter (
        where not scoped.dismissed
          and scoped.reason = 'sexual'
      )::bigint as sexual_count,
      count(*) filter (
        where not scoped.dismissed
          and scoped.reason = 'privacy'
      )::bigint as privacy_count,
      count(*) filter (
        where not scoped.dismissed
          and scoped.reason = 'impersonation'
      )::bigint as impersonation_count,
      count(*) filter (
        where not scoped.dismissed
          and scoped.reason = 'spam'
      )::bigint as spam_count,
      count(*) filter (
        where not scoped.dismissed
          and scoped.reason = 'other'
      )::bigint as other_count,
      max(scoped.created_at) filter (
        where not scoped.dismissed
      ) as latest_at
    from scoped
    group by scoped.post_id
    -- 무시 이후 새 신고가 없으면 목록에서 내려간다.
    having count(*) filter (
      where not scoped.dismissed
    ) > 0
  ),
  shaped as (
    select
      post.id as post_id,
      post.title,
      case
        when char_length(post.body) > 360
          then left(post.body, 360) || '…'
        else post.body
      end as body_preview,
      post.author_identity,

      case
        when post.author_identity = 'anonymous'
          then null
        else author_profile.pub_id
      end as author_pub_id,

      case
        when post.author_identity = 'anonymous'
          then null
        else author_profile.name
      end as author_name,

      case
        when post.author_identity = 'anonymous'
          then null
        else author_profile.avatar_path
      end as author_avatar_path,

      case
        when post.author_identity = 'anonymous'
          then '익명'
        when post.author_identity = 'staff'
          then '운영진'
        else coalesce(author_profile.name, '알 수 없음')
      end as author_label,

      aggregated.report_count,
      aggregated.dismissed_count,
      aggregated.description_count,
      aggregated.abuse_count,
      aggregated.sexual_count,
      aggregated.privacy_count,
      aggregated.impersonation_count,
      aggregated.spam_count,
      aggregated.other_count,
      aggregated.latest_at

    from aggregated
    join public.posts as post
      on post.id = aggregated.post_id
    left join private.post_authors as actual_author
      on actual_author.post_id = post.id

    left join public.profiles as author_profile
      on author_profile.id = case
        when post.author_identity = 'identified'
          then post.display_author_profile_id
        when post.author_identity = 'staff'
          then actual_author.profile_id
        else null
      end
  )

  select
    shaped.post_id,
    shaped.title,
    shaped.body_preview,
    shaped.author_identity,
    shaped.author_pub_id,
    shaped.author_name,
    shaped.author_avatar_path,
    shaped.author_label,
    shaped.report_count,
    shaped.dismissed_count,
    shaped.description_count,
    shaped.abuse_count,
    shaped.sexual_count,
    shaped.privacy_count,
    shaped.impersonation_count,
    shaped.spam_count,
    shaped.other_count,
    shaped.latest_at
  from shaped
  where
    p_cursor_post_id is null
    or (
      p_sort = 'count'
      and (
        shaped.report_count,
        shaped.latest_at,
        shaped.post_id
      ) < (
        p_cursor_report_count,
        p_cursor_latest_at,
        p_cursor_post_id
      )
    )
    or (
      p_sort = 'recent'
      and (
        shaped.latest_at,
        shaped.post_id
      ) < (
        p_cursor_latest_at,
        p_cursor_post_id
      )
    )
  order by
    case
      when p_sort = 'count'
        then shaped.report_count
    end desc,
    shaped.latest_at desc,
    shaped.post_id desc
  limit least(
    greatest(coalesce(p_limit, 20), 1),
    50
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_group_posts (
  p_group_id            uuid,
  p_category_id         uuid                     DEFAULT NULL::uuid,
  p_cursor_published_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_cursor_post_id      uuid                     DEFAULT NULL::uuid,
  p_cursor_is_pinned    boolean                  DEFAULT NULL::boolean,
  p_limit               integer                  DEFAULT 20
)
  RETURNS TABLE (
    post_id                                 uuid,
    group_id                                uuid,
    category_id                             uuid,
    category_name                           text,
    title                                   text,
    body                                    text,
    author_identity                         public.post_identity,
    author_pub_id                           text,
    author_name                             text,
    author_avatar_path                      text,
    author_label                            text,
    is_pinned                               boolean,
    published_at                            timestamp with time zone,
    edited_at                               timestamp with time zone,
    comment_count                           integer,
    reaction_count                          integer,
    top_reactions                           public.post_reaction[],
    my_reaction                             public.post_reaction,
    is_author                               boolean,
    can_edit                                boolean,
    can_delete                              boolean,
    can_pin                                 boolean,
    can_moderate_anonymous                  boolean,
    anonymous_author_restricted             boolean,
    anonymous_author_restriction_expires_at timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  caller_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if (p_cursor_published_at is null) <> (p_cursor_post_id is null)
    or (p_cursor_post_id is null) <> (p_cursor_is_pinned is null) then
    raise exception 'post cursor must be complete' using errcode = '22023';
  end if;
  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id;
  if caller_role is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select
    post.id, post.group_id, post.category_id, category.name,
    post.title, post.body, post.author_identity,
    case when post.author_identity in ('identified', 'staff') then profile.pub_id end,
    case when post.author_identity in ('identified', 'staff') then profile.name end,
    case when post.author_identity in ('identified', 'staff') then profile.avatar_path end,
    case post.author_identity
      when 'identified' then profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    post.pinned_at is not null, post.published_at, post.edited_at,
    post.comment_count,
    summary.total,
    summary.top,
    mine.reaction,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id or caller_role in ('owner', 'admin'),
    caller_role in ('owner', 'admin', 'manager'),
    post.author_identity = 'anonymous' and author.profile_id <> caller_profile_id
      and caller_role in ('owner', 'admin'),
    active_restriction.expires_at is not null,
    active_restriction.expires_at
  from public.posts as post
  join private.post_authors as author on author.post_id = post.id
  left join public.group_categories as category on category.id = post.category_id
  left join public.profiles as profile
    on (
      (post.author_identity = 'identified' and profile.id = post.display_author_profile_id)
      or (post.author_identity = 'staff' and profile.id = author.profile_id)
    )
    and profile.status = 'accepted'
    and profile.deleted_at is null
  left join public.post_reactions as mine
    on mine.post_id = post.id and mine.profile_id = caller_profile_id
  left join lateral (
    select restriction.expires_at
    from private.group_anonymous_activity_restrictions as restriction
    where restriction.group_id = post.group_id
      and restriction.profile_id = author.profile_id
      and restriction.ended_at is null
      and restriction.expires_at > now()
    order by restriction.created_at desc, restriction.id desc
    limit 1
  ) as active_restriction on post.author_identity = 'anonymous'
    and author.profile_id <> caller_profile_id
    and caller_role in ('owner', 'admin')
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
      from public.post_reactions as entry
      where entry.post_id = post.id
      group by entry.reaction
    ) as tally
  ) as summary on true
  where post.group_id = p_group_id and post.kind = 'group'
    and post.published_at is not null
    and (p_category_id is null or post.category_id = p_category_id)
    and (
      p_cursor_post_id is null
      or (
        p_cursor_is_pinned
        and (
          post.pinned_at is null
          or (
            post.pinned_at is not null
            and (post.published_at, post.id) < (p_cursor_published_at, p_cursor_post_id)
          )
        )
      )
      or (
        not p_cursor_is_pinned
        and post.pinned_at is null
        and (post.published_at, post.id) < (p_cursor_published_at, p_cursor_post_id)
      )
    )
  order by (post.pinned_at is not null) desc, post.published_at desc, post.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_notifications (
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
    notification.title, notification.detail, notification.restriction_expires_at,
    notification.created_at, notification.last_activity_at,
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

CREATE OR REPLACE FUNCTION public.list_post_attachments (
  p_post_id uuid
)
  RETURNS TABLE (
    attachment_id     uuid,
    post_id           uuid,
    storage_bucket    text,
    object_path       text,
    original_filename text,
    "position"        integer,
    mime_type         text,
    size_bytes        bigint,
    width             integer,
    height            integer,
    status            public.post_attachment_status,
    created_at        timestamp with time zone,
    ready_at          timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select item.id, item.post_id, item.storage_bucket, item.object_path,
    item.original_filename, item.position, item.mime_type, item.size_bytes,
    item.width, item.height, item.status, item.created_at, item.ready_at
  from public.post_attachments as item
  where item.post_id = p_post_id
    and item.status <> 'deleted'
    and (
      item.status = 'ready'
      or private.is_post_author(item.post_id)
    )
  order by item.position, item.id;
$function$;

CREATE OR REPLACE FUNCTION public.list_post_comment_replies (
  p_root_comment_id uuid
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
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  root_post_id uuid;
  context record;
  visible_ids uuid[];
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select comment.post_id into root_post_id
  from public.post_comments as comment
  where comment.id = p_root_comment_id
    and comment.depth = 0
    and comment.deleted_at is null;
  if root_post_id is null then
    return;
  end if;

  context := private.comment_post_context(root_post_id, caller_profile_id);
  if not context.is_visible then
    return;
  end if;

  -- 삭제된 답글은 살아 있는 자손이 있을 때만 `삭제된 댓글입니다`로 남긴다(기능 명세 §9.4).
  -- 살아 있는 노드에서 부모를 따라 올라가며 표시해야 할 조상을 모은다.
  with recursive subtree as (
    select comment.id, comment.parent_comment_id, comment.deleted_at, comment.depth
    from public.post_comments as comment
    where comment.root_comment_id = p_root_comment_id
  ),
  live_ancestor as (
    select node.parent_comment_id as id
    from subtree as node
    where node.deleted_at is null and node.parent_comment_id is not null
    union
    select node.parent_comment_id
    from live_ancestor as walked
    join subtree as node on node.id = walked.id
    where node.parent_comment_id is not null
  )
  select array_agg(node.id) into visible_ids
  from subtree as node
  where node.depth > 0
    and (
      node.deleted_at is null
      or node.id in (select ancestor.id from live_ancestor as ancestor)
    );

  return query
  select entry.*
  from private.read_post_comments(
    coalesce(visible_ids, '{}'::uuid[]), caller_profile_id, context.caller_role
  ) as entry;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_post_comments (
  p_post_id           uuid,
  p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_cursor_comment_id uuid                     DEFAULT NULL::uuid,
  p_limit             integer                  DEFAULT 20
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
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  context record;
  page_ids uuid[];
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_comment_id is null) then
    raise exception 'comment cursor must be complete' using errcode = '22023';
  end if;

  context := private.comment_post_context(p_post_id, caller_profile_id);
  if not context.is_visible then
    return;
  end if;

  -- 대화를 처음부터 읽을 수 있도록 오래된 최상위 댓글부터 고르고, 커서 뒤의 새 댓글을 잇는다.
  -- 최상위 댓글을 지우면 자손까지 함께 삭제되므로 여기서는 살아 있는 행만 보면 된다.
  select array_agg(page.id order by page.created_at, page.id) into page_ids
  from (
    select comment.id, comment.created_at
    from public.post_comments as comment
    where comment.post_id = p_post_id
      and comment.depth = 0
      and comment.deleted_at is null
      and (
        p_cursor_comment_id is null
        or (comment.created_at, comment.id) > (p_cursor_created_at, p_cursor_comment_id)
      )
    order by comment.created_at, comment.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) as page;

  return query
  select entry.*
  from private.read_post_comments(
    coalesce(page_ids, '{}'::uuid[]), caller_profile_id, context.caller_role
  ) as entry;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_post_reactors (
  p_post_id uuid
)
  RETURNS TABLE (
    reaction            public.post_reaction,
    reactor_pub_id      text,
    reactor_name        text,
    reactor_avatar_path text,
    reacted_at          timestamp with time zone
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
  perform private.reaction_context(p_post_id, caller_profile_id);
  return query
  select entry.reaction, profile.pub_id, profile.name, profile.avatar_path,
    entry.created_at
  from public.post_reactions as entry
  left join public.profiles as profile on profile.id = entry.profile_id
    and profile.status = 'accepted' and profile.deleted_at is null
  where entry.post_id = p_post_id
  order by entry.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_profile_posts (
  p_timeline_pub_id     text,
  p_cursor_published_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_cursor_post_id      uuid                     DEFAULT NULL::uuid,
  p_limit               integer                  DEFAULT 20
)
  RETURNS TABLE (
    post_id             uuid,
    body                text,
    timeline_pub_id     text,
    timeline_name       text,
    author_pub_id       text,
    author_name         text,
    author_avatar_path  text,
    activity_kind       public.profile_media_activity_kind,
    activity_media_path text,
    visibility          public.post_visibility,
    published_at        timestamp with time zone,
    edited_at           timestamp with time zone,
    comment_count       integer,
    reaction_count      integer,
    top_reactions       public.post_reaction[],
    my_reaction         public.post_reaction,
    is_author           boolean,
    can_edit            boolean,
    can_delete          boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_profile_id bigint;
  page_ids uuid[];
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if (p_cursor_published_at is null) <> (p_cursor_post_id is null) then
    raise exception 'post cursor must be complete' using errcode = '22023';
  end if;

  select profile.id into target_profile_id
  from public.profiles as profile
  where profile.pub_id = lower(btrim(p_timeline_pub_id))
    and profile.status = 'accepted'
    and profile.deleted_at is null;
  if target_profile_id is null then
    return;
  end if;

  select array_agg(page.id) into page_ids
  from (
    select post.id
    from public.posts as post
    where post.timeline_profile_id = target_profile_id
      and post.kind = 'profile'
      and post.published_at is not null
      and (
        post.visibility = 'public'
        or exists (
          select 1 from private.post_authors as author
          where author.post_id = post.id and author.profile_id = caller_profile_id
        )
      )
      and (
        p_cursor_post_id is null
        or (post.published_at, post.id) < (p_cursor_published_at, p_cursor_post_id)
      )
    order by post.published_at desc, post.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) as page;

  return query
  select entry.*
  from private.read_profile_posts(
    coalesce(page_ids, '{}'::uuid[]), caller_profile_id
  ) as entry;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_all_my_notifications_read()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  changed bigint;
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  update public.notifications
  set read_at = now()
  where recipient_profile_id = private.current_profile_id() and read_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_my_notification_read (
  p_notification_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id
    and recipient_profile_id = private.current_profile_id();
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.move_group_category (
  p_category_id uuid,
  p_direction   smallint
)
  RETURNS SETOF public.group_categories
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  category_record public.group_categories;
  target_ordinality bigint;
  adjacent_ordinality bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;
  if p_direction not in (-1, 1) then
    raise exception 'direction must be -1 or 1' using errcode = '22023';
  end if;

  select category.* into category_record
  from public.group_categories as category
  where category.id = p_category_id;
  if category_record.id is null then
    raise exception 'category not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.group_memberships as membership
    where membership.group_id = category_record.group_id
      and membership.profile_id = caller_profile_id
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;

  perform 1
  from public.groups as group_record
  where group_record.id = category_record.group_id
  for update;
  perform 1
  from public.group_categories as category
  where category.group_id = category_record.group_id
  order by category.position, category.id
  for update;

  select ordered.ordinality
  into target_ordinality
  from (
    select category.id, row_number() over (order by category.position, category.id) as ordinality
    from public.group_categories as category
    where category.group_id = category_record.group_id
  ) as ordered
  where ordered.id = p_category_id;
  adjacent_ordinality := target_ordinality + p_direction;

  if adjacent_ordinality between 1 and (
    select count(*) from public.group_categories
    where group_id = category_record.group_id
  ) then
    with ordered as (
      select
        category.id,
        row_number() over (order by category.position, category.id) as ordinality
      from public.group_categories as category
      where category.group_id = category_record.group_id
    )
    update public.group_categories as category
    set position = case
      when ordered.ordinality = target_ordinality then adjacent_ordinality - 1
      when ordered.ordinality = adjacent_ordinality then target_ordinality - 1
      else ordered.ordinality - 1
    end
    from ordered
    where category.id = ordered.id;
  end if;

  return query
  select category.*
  from public.group_categories as category
  where category.group_id = category_record.group_id
  order by category.position, category.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_comment_image (
  p_post_id    uuid,
  p_mime_type  text,
  p_size_bytes bigint,
  p_width      integer,
  p_height     integer
)
  RETURNS public.comment_images
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  context record;
  image_id uuid := gen_random_uuid();
  image public.comment_images;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  context := private.comment_post_context(p_post_id, caller_profile_id);
  if context.post_kind is null then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if not context.is_visible then
    raise exception 'post is not accessible' using errcode = '42501';
  end if;
  if p_mime_type is distinct from 'image/webp'
    or p_size_bytes not between 1 and 8388608
    or coalesce(p_width between 1 and 3072, false) is false
    or coalesce(p_height between 1 and 3072, false) is false
    or coalesce(greatest(p_width, p_height) <= 3072, false) is false then
    raise exception 'invalid normalized comment image metadata' using errcode = '22023';
  end if;

  insert into public.comment_images (
    id, post_id, object_path, mime_type, size_bytes, width, height
  ) values (
    image_id, p_post_id, 'comments/' || p_post_id::text || '/' || image_id::text,
    p_mime_type, p_size_bytes, p_width, p_height
  ) returning * into image;

  insert into private.comment_image_uploaders (image_id, profile_id)
  values (image_id, caller_profile_id);

  return image;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_group_media (
  p_group_id   uuid,
  p_slot       public.group_media_slot,
  p_size_bytes bigint,
  p_width      integer,
  p_height     integer
)
  RETURNS TABLE (
    media_id    uuid,
    object_path text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  created_id uuid := gen_random_uuid();
begin
  if not private.can_manage_group(p_group_id) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  insert into public.group_media_objects (
    id, group_id, slot, object_path, size_bytes, width, height
  ) values (
    created_id,
    p_group_id,
    p_slot,
    p_group_id::text || '/' || p_slot::text || '/' || created_id::text,
    p_size_bytes,
    p_width,
    p_height
  );

  return query select created_id,
    p_group_id::text || '/' || p_slot::text || '/' || created_id::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_notification_delivery (
  p_delivery_id uuid,
  p_lease_id    uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  target private.notification_delivery_outbox;
begin
  select delivery.* into target
  from private.notification_delivery_outbox as delivery
  where delivery.id = p_delivery_id
    and delivery.status = 'leased'
    and delivery.lease_id = p_lease_id
    and delivery.lease_expires_at > now()
  for update;

  if target.id is null then return false; end if;
  if private.notification_delivery_allowed(target) then return true; end if;

  update private.notification_delivery_outbox
  set status = 'suppressed', completed_at = now(),
    lease_id = null, lease_expires_at = null,
    last_error_code = 'no_longer_deliverable'
  where id = target.id;

  insert into private.notification_delivery_attempts (
    delivery_id, outcome, error_code
  ) values (target.id, 'suppressed', 'no_longer_deliverable');

  return false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_post_attachment (
  p_post_id           uuid,
  p_original_filename text,
  p_mime_type         text,
  p_size_bytes        bigint,
  p_width             integer DEFAULT NULL::integer,
  p_height            integer DEFAULT NULL::integer
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
  if lower(btrim(p_mime_type)) like 'video/%'
     or lower(btrim(p_original_filename)) ~ '\.(mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|3gp|3g2|ogv|m2ts)$' then
    raise exception 'video attachments are not supported' using errcode = '22023';
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

  insert into public.post_attachments (
    id, post_id, object_path, original_filename, position, mime_type,
    size_bytes, width, height
  ) values (
    attachment_id, p_post_id, p_post_id::text || '/' || attachment_id::text,
    btrim(p_original_filename), next_position, btrim(p_mime_type),
    p_size_bytes, p_width, p_height
  ) returning * into attachment;
  return attachment;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_profile_media (
  p_slot       public.profile_media_slot,
  p_size_bytes bigint,
  p_width      integer,
  p_height     integer
)
  RETURNS TABLE (
    media_id    uuid,
    object_path text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  owner_profile_id bigint;
  created_id uuid := gen_random_uuid();
begin
  select profile.id
  into owner_profile_id
  from public.profiles as profile
  where profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if owner_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  insert into public.profile_media_objects (
    id, profile_id, auth_user_id, slot, object_path, size_bytes, width, height
  ) values (
    created_id,
    owner_profile_id,
    caller_id,
    p_slot,
    caller_id::text || '/' || p_slot::text || '/' || created_id::text,
    p_size_bytes,
    p_width,
    p_height
  );

  return query select created_id,
    caller_id::text || '/' || p_slot::text || '/' || created_id::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_group_post (
  p_post_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
  target_group_id uuid;
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.group_id into target_group_id
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group';
  if target_group_id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can publish this post' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
    and post.group_id = target_group_id;
  if post_record.author_identity = 'anonymous' then
    perform private.lock_group_anonymous_activity_target(
      target_group_id, caller_profile_id
    );
  end if;

  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = target_group_id and group_data.deleted_at is null
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
    and post.group_id = target_group_id
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can publish this post' using errcode = '42501';
  end if;
  if post_record.published_at is not null then
    return p_post_id;
  end if;
  if group_posting_policy = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'group posting is restricted to staff' using errcode = '42501';
  end if;
  if post_record.author_identity = 'anonymous'
    and group_identity_policy = 'identified' then
    raise exception 'anonymous posting is not allowed' using errcode = '42501';
  end if;
  if post_record.author_identity = 'anonymous' then
    perform private.assert_group_anonymous_activity_allowed(
      target_group_id, caller_profile_id
    );
  end if;
  if post_record.author_identity = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status = 'pending'
  ) then
    raise exception 'pending attachments must be finalized or deleted' using errcode = '55000';
  end if;
  if nullif(btrim(post_record.body), '') is null and not exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status = 'ready'
  ) then
    raise exception 'published post requires a body or ready attachment' using errcode = '22023';
  end if;

  update public.posts set published_at = now() where id = p_post_id;
  return p_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.register_my_web_push_subscription (
  p_endpoint        text,
  p_p256dh          text,
  p_auth            text,
  p_expiration_time double precision DEFAULT NULL::double precision
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_endpoint !~ '^https://[^[:space:]]+$'
    or p_p256dh !~ '^[A-Za-z0-9_-]+$'
    or p_auth !~ '^[A-Za-z0-9_-]+$'
    or p_expiration_time < 0
    or p_expiration_time > 253402300799999 then
    raise exception 'invalid web push subscription' using errcode = '22023';
  end if;
  insert into private.web_push_subscriptions as subscription (
    profile_id, endpoint, p256dh, auth, expiration_time
  ) values (
    caller_profile_id, p_endpoint, p_p256dh, p_auth,
    case when p_expiration_time is null
      then null
      else to_timestamp(p_expiration_time / 1000.0)
    end
  ) on conflict (endpoint) do update set
    profile_id = excluded.profile_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    expiration_time = excluded.expiration_time,
    updated_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.reject_group_join_request (
  p_group_id   uuid,
  p_request_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  requested_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = p_group_id for update;

  if not exists (
    select 1
    from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
      and caller_membership.role in ('owner', 'admin')
  ) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  delete from public.group_join_requests as join_request
  where join_request.group_id = p_group_id
    and join_request.id = p_request_id
  returning join_request.profile_id into requested_profile_id;

  if not found then
    raise exception 'join request not found' using errcode = 'P0002';
  end if;

  perform private.emit_notification(
    'group-join-rejected:' || p_request_id::text,
    requested_profile_id, 'group_join_rejected', 'normal', 'group', 'staff',
    caller_profile_id, '운영진', null, '그룹 가입 요청이 거절되었습니다.', p_group_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_group_media (
  p_group_id uuid,
  p_slot     public.group_media_slot
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  previous_path text;
begin
  if not private.can_manage_group(p_group_id) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;

  if p_slot = 'icon' then
    select icon_path into previous_path from public.groups where id = p_group_id for update;
    update public.groups set icon_path = null where id = p_group_id;
  else
    select cover_path into previous_path from public.groups where id = p_group_id for update;
    update public.groups set cover_path = null where id = p_group_id;
  end if;

  if previous_path is not null then
    update public.group_media_objects
    set status = 'deleted', deleted_at = now()
    where object_path = previous_path and status = 'ready';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_my_profile_media (
  p_slot text
)
  RETURNS public.profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  current_profile public.profiles;
  updated_profile public.profiles;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_slot not in ('avatar', 'cover') then
    raise exception 'invalid profile media slot' using errcode = '22023';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;

  if current_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  if p_slot = 'avatar' then
    update public.profiles
    set avatar_path = null
    where id = current_profile.id
    returning * into updated_profile;
  else
    update public.profiles
    set cover_path = null
    where id = current_profile.id
    returning * into updated_profile;
  end if;

  return updated_profile;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reorder_post_attachments (
  p_post_id        uuid,
  p_attachment_ids uuid[]
)
  RETURNS SETOF public.post_attachments
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  active_count integer;
begin
  perform 1 from public.posts where id = p_post_id for update;
  if not found or not private.is_post_author(p_post_id) then
    raise exception 'only the author can reorder attachments' using errcode = '42501';
  end if;
  if p_attachment_ids is null
    or cardinality(p_attachment_ids) > 30
    or cardinality(p_attachment_ids) <> (
      select count(distinct id) from unnest(p_attachment_ids) as id
    ) then
    raise exception 'attachment order must contain unique ids' using errcode = '22023';
  end if;
  select count(*) into active_count from public.post_attachments
  where post_id = p_post_id and status <> 'deleted';
  if cardinality(p_attachment_ids) <> active_count
    or exists (
      select 1 from unnest(p_attachment_ids) as requested(id)
      where not exists (
        select 1 from public.post_attachments as item
        where item.id = requested.id and item.post_id = p_post_id and item.status <> 'deleted'
      )
    ) then
    raise exception 'attachment order must contain every active attachment exactly once'
      using errcode = '22023';
  end if;

  -- Move to a disjoint range first so the partial unique index stays valid.
  update public.post_attachments set position = -position - 1
  where post_id = p_post_id and status <> 'deleted';
  update public.post_attachments as item
  set position = requested.ordinality - 1
  from unnest(p_attachment_ids) with ordinality as requested(id, ordinality)
  where item.id = requested.id;

  return query select item.* from public.post_attachments as item
  where item.post_id = p_post_id and item.status <> 'deleted'
  order by item.position, item.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.report_group_post (
  p_post_id     uuid,
  p_reason      public.group_post_report_reason,
  p_description text                            DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint;
  post_record public.posts%rowtype;
  normalized_description text;
begin
  caller_profile_id := private.current_profile_id();

  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required'
      using errcode = '42501';
  end if;

  select post.*
  into post_record
  from public.posts as post
  where post.id = p_post_id
    and post.kind = 'group'
    and post.published_at is not null;

  if post_record.id is null then
    raise exception 'post not found'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = post_record.group_id
      and membership.profile_id = caller_profile_id
  ) then
    raise exception 'group membership required'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from private.post_authors as author
    where author.post_id = p_post_id
      and author.profile_id = caller_profile_id
  ) then
    raise exception 'cannot report own post'
      using errcode = '42501';
  end if;

  normalized_description :=
    nullif(btrim(coalesce(p_description, '')), '');

  if normalized_description is not null
    and char_length(normalized_description) not between 5 and 300
  then
    raise exception 'description must be between 5 and 300 characters'
      using errcode = '22023';
  end if;

  if p_reason = 'other'
    and normalized_description is null
  then
    raise exception 'description is required for other reason'
      using errcode = '22023';
  end if;

  insert into private.group_post_reports (
    post_id,
    reporter_profile_id,
    reason,
    description
  )
  values (
    p_post_id,
    caller_profile_id,
    p_reason,
    normalized_description
  );

exception
  when unique_violation then
    raise exception 'post already reported'
      using errcode = '23505';
end;
$function$;

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
      where group_record.id = target.group_id and group_record.deleted_at is null;
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
    where group_record.id = target.group_id and group_record.deleted_at is null;
    if group_slug is not null then destination := '/groups/' || group_slug; end if;
  elsif target.target_profile_id is not null then
    select profile.pub_id into profile_pub_id
    from public.profiles as profile
    where profile.id = target.target_profile_id
      and profile.status = 'accepted' and profile.deleted_at is null;
    if profile_pub_id is not null then destination := '/profile/' || profile_pub_id; end if;
  elsif target.kind = 'gongang_preempted' then
    destination := '/util/gongang';
  end if;

  update public.notifications set read_at = coalesce(read_at, now()) where id = target.id;
  return destination;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restrict_group_anonymous_activity (
  p_source_kind   text,
  p_source_id     uuid,
  p_reason        text,
  p_duration_days integer
)
  RETURNS TABLE (
    restriction_id uuid,
    expires_at     timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_group_id uuid;
  target_profile_id bigint;
  caller_role public.group_member_role;
  created_restriction_id uuid;
  restriction_expires_at timestamptz;
  trimmed_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_source_kind not in ('post', 'comment') or p_source_id is null then
    raise exception 'invalid anonymous moderation source' using errcode = '22023';
  end if;
  if char_length(trimmed_reason) not between 5 and 300 then
    raise exception 'reason must contain between 5 and 300 characters' using errcode = '22023';
  end if;
  if p_duration_days is null or p_duration_days not between 1 and 180 then
    raise exception 'duration days must be an integer between 1 and 180' using errcode = '22023';
  end if;

  if p_source_kind = 'post' then
    select post.group_id, author.profile_id into target_group_id, target_profile_id
    from public.posts as post
    join public.groups as group_record on group_record.id = post.group_id and group_record.deleted_at is null
    join private.post_authors as author on author.post_id = post.id
    where post.id = p_source_id and post.kind = 'group'
      and post.author_identity = 'anonymous'
      and post.published_at is not null;
  else
    select post.group_id, author.profile_id into target_group_id, target_profile_id
    from public.post_comments as comment
    join public.posts as post on post.id = comment.post_id and post.kind = 'group'
      and post.published_at is not null
    join public.groups as group_record on group_record.id = post.group_id and group_record.deleted_at is null
    join private.comment_authors as author on author.comment_id = comment.id
    where comment.id = p_source_id and comment.author_identity = 'anonymous'
      and comment.deleted_at is null;
  end if;
  if target_profile_id is null then
    raise exception 'anonymous moderation source not found' using errcode = 'P0002';
  end if;

  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = target_group_id and membership.profile_id = caller_profile_id;
  if caller_role not in ('owner', 'admin') then
    raise exception 'group anonymous moderation is not allowed' using errcode = '42501';
  end if;
  if target_profile_id = caller_profile_id then
    raise exception 'cannot moderate own anonymous activity' using errcode = '42501';
  end if;

  perform private.lock_group_anonymous_activity_target(target_group_id, target_profile_id);
  perform 1 from public.group_memberships as membership
  where membership.group_id = target_group_id and membership.profile_id = target_profile_id
  for update;
  update private.group_anonymous_activity_restrictions as restriction
  set ended_at = restriction.expires_at
  where restriction.group_id = target_group_id and restriction.profile_id = target_profile_id
    and restriction.ended_at is null and restriction.expires_at <= now();
  if exists (
    select 1 from private.group_anonymous_activity_restrictions as restriction
    where restriction.group_id = target_group_id and restriction.profile_id = target_profile_id
      and restriction.ended_at is null and restriction.expires_at > now()
  ) then
    raise exception 'anonymous activity restriction already active' using errcode = '55000';
  end if;

  restriction_expires_at := now() + make_interval(days => p_duration_days);
  insert into private.group_anonymous_activity_restrictions (
    group_id, profile_id, reason, expires_at, restricted_by_profile_id,
    source_kind, source_post_id, source_comment_id
  ) values (
    target_group_id, target_profile_id, trimmed_reason, restriction_expires_at,
    caller_profile_id, p_source_kind,
    case when p_source_kind = 'post' then p_source_id end,
    case when p_source_kind = 'comment' then p_source_id end
  ) returning id into created_restriction_id;
  return query select created_restriction_id, restriction_expires_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_group_invite (
  p_group_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.assert_group_invite_manager(p_group_id);

  delete from private.group_invites as invite
  where invite.group_id = p_group_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.search_group_posts (
  p_group_id uuid,
  p_query    text,
  p_limit    integer DEFAULT 50
)
  RETURNS TABLE (
    post_id            uuid,
    group_id           uuid,
    category_id        uuid,
    category_name      text,
    title              text,
    body               text,
    author_identity    public.post_identity,
    author_pub_id      text,
    author_name        text,
    author_avatar_path text,
    author_label       text,
    is_pinned          boolean,
    published_at       timestamp with time zone,
    edited_at          timestamp with time zone,
    is_author          boolean,
    can_edit           boolean,
    can_delete         boolean,
    can_pin            boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  caller_role public.group_member_role;
  normalized_query text := lower(
    regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g')
  );
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select membership.role into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id;
  if caller_role is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  return query
  select
    post.id, post.group_id, post.category_id, category.name,
    post.title, post.body, post.author_identity,
    case when post.author_identity in ('identified', 'staff') then profile.pub_id end,
    case when post.author_identity in ('identified', 'staff') then profile.name end,
    case when post.author_identity in ('identified', 'staff') then profile.avatar_path end,
    case post.author_identity
      when 'identified' then profile.name
      when 'anonymous' then '익명'
      when 'staff' then '운영진'
    end,
    post.pinned_at is not null, post.published_at, post.edited_at,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id,
    author.profile_id = caller_profile_id or caller_role in ('owner', 'admin'),
    caller_role in ('owner', 'admin', 'manager')
  from public.posts as post
  join private.post_authors as author on author.post_id = post.id
  left join public.group_categories as category on category.id = post.category_id
  left join public.profiles as profile
    on (
      (post.author_identity = 'identified' and profile.id = post.display_author_profile_id)
      or (post.author_identity = 'staff' and profile.id = author.profile_id)
    )
    and profile.status = 'accepted'
    and profile.deleted_at is null
  where post.group_id = p_group_id and post.kind = 'group'
    and post.published_at is not null
    and nullif(normalized_query, '') is not null
    and (
      post.search_text like '%' || normalized_query || '%'
      or profile.search_name like '%' || normalized_query || '%'
    )
  order by post.published_at desc, post.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_comment_reaction (
  p_comment_id uuid,
  p_reaction   public.post_reaction
)
  RETURNS TABLE (
    reaction_count integer,
    top_reactions  public.post_reaction[],
    my_reaction    public.post_reaction
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_post_id uuid;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select comment.post_id into target_post_id
  from public.post_comments as comment
  where comment.id = p_comment_id;
  if target_post_id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;
  perform private.lock_reaction_context(target_post_id, caller_profile_id);

  perform 1
  from public.post_comments as comment
  where comment.id = p_comment_id
    and comment.post_id = target_post_id
    and comment.deleted_at is null
  for update;
  if not found then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  insert into public.comment_reactions as target (comment_id, profile_id, reaction)
  values (p_comment_id, caller_profile_id, p_reaction)
  on conflict (comment_id, profile_id) do update
  set reaction = excluded.reaction, created_at = now()
  where target.reaction is distinct from excluded.reaction;
  return query select * from private.comment_reaction_summary(p_comment_id, caller_profile_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_group_post_pinned (
  p_post_id uuid,
  p_pinned  boolean
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id
    and post.kind = 'group'
    and post.published_at is not null
  for update;

  if post_record.id is null or not exists (
    select 1 from public.group_memberships as membership
    where membership.group_id = post_record.group_id
      and membership.profile_id = caller_profile_id
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'post pinning is not allowed' using errcode = '42501';
  end if;

  update public.posts
  set pinned_at = case when p_pinned then coalesce(pinned_at, now()) else null end
  where id = p_post_id;
  return p_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_my_group_notification_preferences (
  p_group_id              uuid,
  p_notification_level    public.group_notification_level,
  p_content_push_enabled  boolean,
  p_new_post_push_enabled boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_notification_level is null
    or p_content_push_enabled is null
    or p_new_post_push_enabled is null then
    raise exception 'group notification preferences must not be null' using errcode = '22023';
  end if;
  update public.group_memberships
  set notification_level = p_notification_level,
    content_push_enabled = p_notification_level <> 'none' and p_content_push_enabled,
    new_post_push_enabled = p_notification_level = 'all' and p_new_post_push_enabled
  where group_id = p_group_id and profile_id = private.current_profile_id();
  if not found then
    raise exception 'group membership required' using errcode = '42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_post_reaction (
  p_post_id  uuid,
  p_reaction public.post_reaction
)
  RETURNS TABLE (
    reaction_count integer,
    top_reactions  public.post_reaction[],
    my_reaction    public.post_reaction
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  perform private.lock_reaction_context(p_post_id, caller_profile_id);
  insert into public.post_reactions as target (post_id, profile_id, reaction)
  values (p_post_id, caller_profile_id, p_reaction)
  on conflict (post_id, profile_id) do update
  set reaction = excluded.reaction, created_at = now()
  where target.reaction is distinct from excluded.reaction;
  return query select * from private.post_reaction_summary(p_post_id, caller_profile_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_my_profile (
  p_name           text,
  p_type           public.profile_type,
  p_student_number text                          DEFAULT NULL::text,
  p_class_no       smallint                      DEFAULT NULL::smallint,
  p_cohort         smallint                      DEFAULT NULL::smallint,
  p_gender         public.profile_gender         DEFAULT NULL::public.profile_gender,
  p_academic_track public.profile_academic_track DEFAULT NULL::public.profile_academic_track,
  p_phone_number   text                          DEFAULT NULL::text,
  p_birthday       date                          DEFAULT NULL::date,
  p_dorm_room      smallint                      DEFAULT NULL::smallint
)
  RETURNS public.profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  existing_profile public.profiles;
  submitted_profile public.profiles;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = caller_id
      and email_confirmed_at is not null
  ) then
    raise exception 'email confirmation required' using errcode = '42501';
  end if;

  select profile.*
  into existing_profile
  from public.profiles as profile
  where profile.auth_user_id = caller_id
  for update;

  if found and existing_profile.status <> 'draft' then
    raise exception 'profile cannot be submitted in its current state'
      using errcode = '55000';
  end if;

  if existing_profile.id is null then
    insert into public.profiles (
      auth_user_id, name, type, student_number, class_no, cohort, gender,
      academic_track, phone_number, birthday, dorm_room
    )
    values (
      caller_id, btrim(p_name), p_type, nullif(btrim(p_student_number), ''),
      p_class_no, p_cohort, p_gender, p_academic_track,
      nullif(btrim(p_phone_number), ''), p_birthday, p_dorm_room
    )
    returning * into submitted_profile;
  else
    update public.profiles
    set
      name = btrim(p_name),
      type = p_type,
      student_number = nullif(btrim(p_student_number), ''),
      class_no = p_class_no,
      cohort = p_cohort,
      gender = p_gender,
      academic_track = p_academic_track,
      phone_number = nullif(btrim(p_phone_number), ''),
      birthday = p_birthday,
      dorm_room = p_dorm_room,
      status = 'pending',
      submitted_at = now(),
      status_updated_at = now(),
      status_updated_by = null,
      deleted_at = null
    where id = existing_profile.id
    returning * into submitted_profile;
  end if;

  return submitted_profile;
end;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_group_ownership (
  p_group_id             uuid,
  p_target_membership_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  owner_membership_id uuid;
  target_role public.group_member_role;
  target_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = p_group_id for update;

  select membership.id
  into owner_membership_id
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id
    and membership.role = 'owner'
  for update;

  select membership.role, membership.profile_id
  into target_role, target_profile_id
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.id = p_target_membership_id
  for update;

  if owner_membership_id is null or target_role is distinct from 'admin' then
    raise exception 'ownership can only be transferred to an administrator'
      using errcode = '42501';
  end if;

  update public.group_memberships
  set role = 'admin'
  where id = owner_membership_id;

  update public.group_memberships
  set role = 'owner'
  where id = p_target_membership_id;

  perform private.emit_notification(
    'group-ownership:' || p_group_id::text || ':' || txid_current()::text || ':new',
    target_profile_id, 'group_ownership_transferred', 'high', 'group', 'staff',
    caller_profile_id, '운영진', null, '그룹 소유권을 이전받았습니다.', p_group_id
  );
  perform private.emit_notification(
    'group-ownership:' || p_group_id::text || ':' || txid_current()::text || ':old',
    caller_profile_id, 'group_ownership_transferred', 'high', 'group', 'staff',
    target_profile_id, '운영진', null, '그룹 소유권이 이전되었습니다.', p_group_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.unregister_my_web_push_subscription (
  p_endpoint text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null or private.current_profile_id() is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  delete from private.web_push_subscriptions
  where endpoint = p_endpoint and profile_id = private.current_profile_id();
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_group_category (
  p_category_id uuid,
  p_name        text,
  p_position    integer
)
  RETURNS public.group_categories
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  category_record public.group_categories;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;

  select category.* into category_record
  from public.group_categories as category
  where category.id = p_category_id
  for update;

  if category_record.id is null then
    raise exception 'category not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.group_memberships as membership
    where membership.group_id = category_record.group_id
      and membership.profile_id = caller_profile_id
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'category mutation is not allowed' using errcode = '42501';
  end if;

  update public.group_categories
  set name = btrim(p_name), position = p_position
  where id = p_category_id
  returning * into category_record;
  return category_record;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_group_member_role (
  p_group_id      uuid,
  p_membership_id uuid,
  p_role          public.group_member_role
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  caller_role public.group_member_role;
  target_role public.group_member_role;
  target_profile_id bigint;
begin
  if auth.uid() is null or caller_profile_id is null or p_role = 'owner' then
    raise exception 'role change is not allowed' using errcode = '42501';
  end if;

  select membership.role
  into caller_role
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.profile_id = caller_profile_id
  for update;

  select membership.role, membership.profile_id
  into target_role, target_profile_id
  from public.group_memberships as membership
  where membership.group_id = p_group_id
    and membership.id = p_membership_id
  for update;

  if caller_role not in ('owner', 'admin') or target_role is null or target_role = 'owner' then
    raise exception 'role change is not allowed' using errcode = '42501';
  end if;

  if p_role = 'admin' and caller_role <> 'owner' then
    raise exception 'only the owner can appoint an administrator' using errcode = '42501';
  end if;

  if target_role = 'admin' and caller_role <> 'owner' then
    raise exception 'only the owner can change an administrator' using errcode = '42501';
  end if;

  update public.group_memberships
  set role = p_role
  where group_id = p_group_id
    and id = p_membership_id;

  if target_role is distinct from p_role then
    perform private.emit_notification(
      'group-role:' || p_membership_id::text || ':' || txid_current()::text,
      target_profile_id, 'group_role_changed', 'normal', 'group', 'staff',
      caller_profile_id, '운영진', null, '그룹 역할이 변경되었습니다.', p_group_id
    );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_group_post_draft_identity (
  p_post_id         uuid,
  p_author_identity public.post_identity
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  target_group_id uuid;
  locked_group_id uuid;
  group_identity_policy public.group_identity_policy;
  group_posting_policy public.group_posting_policy;
  member_role public.group_member_role;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if p_author_identity is null then
    raise exception 'author identity is required' using errcode = '22023';
  end if;

  select post.group_id into target_group_id
  from public.posts as post
  where post.id = p_post_id
    and post.kind = 'group'
    and post.activity_kind is null
    and post.published_at is null
    and private.is_post_author(post.id);
  if target_group_id is null then
    raise exception 'only the author can change an unpublished group draft identity'
      using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.lock_group_anonymous_activity_target(target_group_id, caller_profile_id);
  end if;

  select group_data.id, group_data.identity_policy, group_data.posting_policy,
    membership.role
  into locked_group_id, group_identity_policy, group_posting_policy, member_role
  from public.groups as group_data
  join public.group_memberships as membership
    on membership.group_id = group_data.id and membership.profile_id = caller_profile_id
  where group_data.id = target_group_id and group_data.deleted_at is null
  for share of group_data, membership;
  if locked_group_id is null then
    raise exception 'group membership required' using errcode = '42501';
  end if;

  perform 1
  from public.posts as post
  where post.id = p_post_id
    and post.kind = 'group'
    and post.group_id = target_group_id
    and post.activity_kind is null
    and post.published_at is null
    and private.is_post_author(post.id)
  for update;
  if not found then
    raise exception 'only the author can change an unpublished group draft identity'
      using errcode = '42501';
  end if;
  if group_posting_policy = 'staff'
    and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'group posting is restricted to staff' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' and group_identity_policy = 'identified' then
    raise exception 'anonymous posting is not allowed' using errcode = '42501';
  end if;
  if p_author_identity = 'anonymous' then
    perform private.assert_group_anonymous_activity_allowed(target_group_id, caller_profile_id);
  end if;
  if p_author_identity = 'staff' and member_role not in ('owner', 'admin', 'manager') then
    raise exception 'staff identity is not allowed' using errcode = '42501';
  end if;

  perform set_config('app.update_group_post_draft_identity', p_post_id::text, true);
  update public.posts
  set author_identity = p_author_identity,
    display_author_profile_id = case
      when p_author_identity = 'identified' then caller_profile_id
    end
  where id = p_post_id;
  return p_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_group_post (
  p_post_id     uuid,
  p_title       text,
  p_body        text,
  p_category_id uuid DEFAULT NULL::uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can update this post' using errcode = '42501';
  end if;
  if not private.is_group_member(post_record.group_id) then
    raise exception 'group membership required' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 100 then
    raise exception 'title must contain between 1 and 100 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(p_body, '')) > 20000 then
    raise exception 'body must contain between 0 and 20000 characters' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null and not exists (
    select 1 from public.post_attachments
    where post_id = p_post_id and status = 'ready'
  ) then
    raise exception 'post requires a body or ready attachment' using errcode = '22023';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.group_categories as category
    where category.id = p_category_id and category.group_id = post_record.group_id
  ) then
    raise exception 'category must belong to the group' using errcode = '22023';
  end if;

  update public.posts
  set title = btrim(p_title), body = coalesce(p_body, ''), category_id = p_category_id,
    edited_at = case when published_at is not null then now() else null end
  where id = p_post_id;
  return p_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_group_settings (
  p_group_id        uuid,
  p_name            text,
  p_description     text,
  p_join_policy     public.group_join_policy,
  p_identity_policy public.group_identity_policy,
  p_posting_policy  public.group_posting_policy
)
  RETURNS TABLE (
    name            text,
    description     text,
    join_policy     public.group_join_policy,
    identity_policy public.group_identity_policy,
    posting_policy  public.group_posting_policy,
    updated_at      timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  current_group public.groups%rowtype;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'group administrator required' using errcode = '42501';
  end if;
  select group_record.* into current_group
  from public.groups as group_record
  where group_record.id = p_group_id
  for update;
  if not exists (
    select 1 from public.group_memberships as caller_membership
    where caller_membership.group_id = p_group_id
      and caller_membership.profile_id = caller_profile_id
      and caller_membership.role in ('owner', 'admin')
  ) then
    raise exception 'group administrator required' using errcode = '42501';
  end if;
  if current_group.join_policy <> 'invite_only' and p_join_policy = 'invite_only' then
    raise exception 'public groups cannot become private' using errcode = '55000';
  end if;
  if current_group.join_policy = 'request' and p_join_policy <> 'request' and exists (
    select 1 from public.group_join_requests as join_request
    where join_request.group_id = p_group_id
  ) then
    raise exception 'pending join requests must be resolved first' using errcode = '55000';
  end if;

  return query
  update public.groups as group_record
  set name = btrim(p_name), description = btrim(coalesce(p_description, '')),
    join_policy = p_join_policy, identity_policy = p_identity_policy,
    posting_policy = p_posting_policy
  where group_record.id = p_group_id
  returning group_record.name, group_record.description, group_record.join_policy,
    group_record.identity_policy, group_record.posting_policy, group_record.updated_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_my_notification_preferences (
  p_content_push_enabled  boolean,
  p_timeline_push_enabled boolean,
  p_group_push_enabled    boolean,
  p_account_push_enabled  boolean,
  p_school_push_enabled   boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if pg_catalog.num_nonnulls(
    p_content_push_enabled, p_timeline_push_enabled, p_group_push_enabled,
    p_account_push_enabled, p_school_push_enabled
  ) <> 5 then
    raise exception 'notification preferences must not be null' using errcode = '22023';
  end if;
  insert into public.notification_preferences as preference (
    profile_id, content_push_enabled, timeline_push_enabled,
    group_push_enabled, account_push_enabled, school_push_enabled
  ) values (
    caller_profile_id, p_content_push_enabled, p_timeline_push_enabled,
    p_group_push_enabled, p_account_push_enabled, p_school_push_enabled
  ) on conflict (profile_id) do update set
    content_push_enabled = excluded.content_push_enabled,
    timeline_push_enabled = excluded.timeline_push_enabled,
    group_push_enabled = excluded.group_push_enabled,
    account_push_enabled = excluded.account_push_enabled,
    school_push_enabled = excluded.school_push_enabled,
    updated_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_my_profile (
  p_name                 text,
  p_description          text                          DEFAULT NULL::text,
  p_birthday             date                          DEFAULT NULL::date,
  p_phone_number         text                          DEFAULT NULL::text,
  p_contact_email        text                          DEFAULT NULL::text,
  p_gender               public.profile_gender         DEFAULT NULL::public.profile_gender,
  p_cohort               smallint                      DEFAULT NULL::smallint,
  p_academic_track       public.profile_academic_track DEFAULT NULL::public.profile_academic_track,
  p_department           text                          DEFAULT NULL::text,
  p_class_no             smallint                      DEFAULT NULL::smallint,
  p_dorm_room            smallint                      DEFAULT NULL::smallint,
  p_allow_timeline_posts boolean                       DEFAULT true,
  p_is_returning_student boolean                       DEFAULT false,
  p_pub_id               text                          DEFAULT NULL::text
)
  RETURNS public.profiles
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_id uuid := auth.uid();
  current_profile public.profiles;
  updated_profile public.profiles;
  next_pub_id text := nullif(btrim(lower(coalesce(p_pub_id, ''))), '');
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.auth_user_id = caller_id
    and profile.status = 'accepted'
    and profile.deleted_at is null
  for update;

  if current_profile.id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  -- 공개 ID를 비워 보내면 바꾸지 않겠다는 뜻이다. 형식과 예약어는 profiles의 check
  -- 제약이 판정하고, 여기서는 선점 여부만 미리 본다. 고유 인덱스가 뒤를 받치므로 이
  -- 검사는 경합을 막으려는 것이 아니라 흔한 실패에 23505를 붙여 주기 위한 것이다 (§12.2).
  next_pub_id := coalesce(next_pub_id, current_profile.pub_id);

  if next_pub_id <> lower(current_profile.pub_id)
    and exists (
      select 1
      from public.profiles as other
      where lower(other.pub_id) = next_pub_id
    ) then
    raise exception 'public id already taken' using errcode = '23505';
  end if;

  if char_length(coalesce(p_description, '')) > 500 then
    raise exception 'description must be at most 500 characters'
      using errcode = '22001';
  end if;

  if p_department is not null and char_length(btrim(p_department)) > 100 then
    raise exception 'department must be at most 100 characters'
      using errcode = '22001';
  end if;

  if current_profile.type in ('student', 'alumni')
    and (
      p_gender is null
      or p_cohort is null
      or p_academic_track is null
    ) then
    raise exception 'academic profile fields are required'
      using errcode = '22023';
  end if;

  if current_profile.type = 'student' and p_birthday is null then
    raise exception 'student birthday is required'
      using errcode = '22023';
  end if;

  update public.profiles
  set
    pub_id = next_pub_id,
    name = btrim(p_name),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    birthday = p_birthday,
    phone_number = nullif(btrim(coalesce(p_phone_number, '')), ''),
    contact_email = nullif(btrim(coalesce(p_contact_email, '')), ''),
    allow_timeline_posts = p_allow_timeline_posts,

    is_returning_student = case
      when current_profile.type = 'student'
        then p_is_returning_student
      else false
    end,

    gender = case
      when current_profile.type in ('student', 'alumni') then p_gender
      else null
    end,

    cohort = current_profile.cohort,

    academic_track = case
      when current_profile.type in ('student', 'alumni')
        then p_academic_track
      else null
    end,

    department = case
      when current_profile.type = 'student'
        then nullif(btrim(coalesce(p_department, '')), '')
      else null
    end,

    class_no = case
      when current_profile.type = 'student' then p_class_no
      else null
    end,

    dorm_room = case
      when current_profile.type = 'student' then p_dorm_room
      else null
    end

  where id = current_profile.id
  returning * into updated_profile;

  return updated_profile;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_post_comment (
  p_comment_id   uuid,
  p_body         text,
  p_image_id     uuid    DEFAULT NULL::uuid,
  p_remove_image boolean DEFAULT false
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
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  comment_record public.post_comments;
  current_image public.comment_images;
  next_image public.comment_images;
  context record;
  trimmed_body text := btrim(coalesce(p_body, ''));
  image_changed boolean;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select comment.* into comment_record
  from public.post_comments as comment
  where comment.id = p_comment_id and comment.deleted_at is null
  for update;
  if comment_record.id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from private.comment_authors as author
    where author.comment_id = p_comment_id and author.profile_id = caller_profile_id
  ) then
    raise exception 'only the author can edit a comment' using errcode = '42501';
  end if;
  if exists (
    select 1
    from private.feed_bump_events as bump
    where bump.comment_id = p_comment_id
  ) then
    raise exception 'effective #업 comments cannot be edited' using errcode = '22023';
  end if;

  context := private.comment_post_context(comment_record.post_id, caller_profile_id);
  if not context.is_visible then
    raise exception 'post is not accessible' using errcode = '42501';
  end if;
  if char_length(trimmed_body) > 5000 then
    raise exception 'comment must contain between 1 and 5000 characters' using errcode = '22023';
  end if;
  if coalesce(p_remove_image, false) and p_image_id is not null then
    raise exception 'cannot replace and remove a comment image together' using errcode = '22023';
  end if;

  select image.* into current_image
  from public.comment_images as image
  where image.comment_id = p_comment_id and image.status = 'ready'
  for update;
  if trimmed_body = ''
    and p_image_id is null
    and (coalesce(p_remove_image, false) or current_image.id is null) then
    raise exception 'comment requires a body or finalized image' using errcode = '22023';
  end if;
  image_changed := case
    when coalesce(p_remove_image, false) then current_image.id is not null
    when p_image_id is null then false
    else current_image.id is distinct from p_image_id
  end;

  if p_image_id is not null and image_changed then
    select image.* into next_image
    from public.comment_images as image
    where image.id = p_image_id
    for update;
    if next_image.id is null
      or next_image.post_id <> comment_record.post_id
      or next_image.status <> 'finalized'
      or next_image.comment_id is not null
      or not private.is_comment_image_uploader(p_image_id) then
      raise exception 'finalized comment image is not claimable' using errcode = '42501';
    end if;
  end if;

  if image_changed and current_image.id is not null then
    update public.comment_images
    set status = 'deleted', deleted_at = now()
    where id = current_image.id;
  end if;
  if p_image_id is not null and image_changed then
    update public.comment_images
    set comment_id = p_comment_id, status = 'ready', ready_at = now()
    where id = p_image_id;
  end if;

  update public.post_comments as comment
  set body = trimmed_body,
    edited_at = case
      when comment_record.body is distinct from trimmed_body or image_changed then now()
      else comment_record.edited_at
    end
  where comment.id = p_comment_id;

  return query
  select entry.*
  from private.read_post_comments(
    array[p_comment_id], caller_profile_id, context.caller_role
  ) as entry;
end;
$function$;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_publication_timestamps CHECK ((published_at IS NULL OR published_at >= created_at) AND (edited_at IS NULL OR published_at IS
    NOT NULL AND edited_at >= published_at) AND (pinned_at IS NULL OR published_at IS NOT NULL AND pinned_at >= published_at));

CREATE INDEX posts_public_profile_feed_idx ON public.posts (published_at DESC, id DESC)
  WHERE kind = 'profile'::public.post_kind AND visibility = 'public'::public.post_visibility AND published_at IS NOT NULL;

CREATE INDEX posts_timeline_idx ON public.posts (timeline_profile_id, published_at DESC, id DESC)
  WHERE kind = 'profile'::public.post_kind AND published_at IS NOT NULL;

CREATE INDEX posts_category_recent_idx ON public.posts (group_id, category_id, published_at DESC, id DESC)
  WHERE kind = 'group'::public.post_kind AND category_id IS NOT NULL AND published_at IS NOT NULL;

CREATE INDEX posts_group_pinned_idx ON public.posts (group_id, published_at DESC, id DESC)
  WHERE kind = 'group'::public.post_kind AND pinned_at IS NOT NULL;

CREATE INDEX posts_group_recent_idx ON public.posts (group_id, published_at DESC, id DESC)
  WHERE kind = 'group'::public.post_kind AND published_at IS NOT NULL;

CREATE INDEX posts_group_search_idx ON public.posts USING gin (search_text extensions.gin_trgm_ops)
  WHERE kind = 'group'::public.post_kind AND published_at IS NOT NULL;
