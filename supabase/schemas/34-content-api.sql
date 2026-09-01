-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


CREATE OR REPLACE FUNCTION "private"."comment_post_context"("p_post_id" "uuid", "p_caller_profile_id" bigint, OUT "is_visible" boolean, OUT "post_kind" "public"."post_kind", OUT "caller_role" "public"."group_member_role", OUT "identity_policy" "public"."group_identity_policy", OUT "post_author_identity" "public"."post_identity") RETURNS "record"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  post_record public.posts;
begin
  is_visible := false;

  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id
    and post.published_at is not null
    and post.deleted_at is null;
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
$$;

ALTER FUNCTION "private"."comment_post_context"("p_post_id" "uuid", "p_caller_profile_id" bigint, OUT "is_visible" boolean, OUT "post_kind" "public"."post_kind", OUT "caller_role" "public"."group_member_role", OUT "identity_policy" "public"."group_identity_policy", OUT "post_author_identity" "public"."post_identity") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."read_post_comments"("p_comment_ids" "uuid"[], "p_caller_profile_id" bigint, "p_caller_role" "public"."group_member_role") RETURNS TABLE("comment_id" "uuid", "post_id" "uuid", "parent_comment_id" "uuid", "root_comment_id" "uuid", "depth" smallint, "body" "text", "author_identity" "public"."post_identity", "author_pub_id" "text", "author_name" "text", "author_avatar_path" "text", "author_label" "text", "created_at" timestamp with time zone, "edited_at" timestamp with time zone, "is_deleted" boolean, "is_effective_feed_bump" boolean, "is_author" boolean, "can_edit" boolean, "can_delete" boolean, "reply_count" integer, "reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction", "parent_author_label" "text", "can_moderate_anonymous" boolean, "anonymous_author_restricted" boolean, "anonymous_author_restriction_expires_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "private"."read_post_comments"("p_comment_ids" "uuid"[], "p_caller_profile_id" bigint, "p_caller_role" "public"."group_member_role") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."read_profile_posts"("p_post_ids" "uuid"[], "p_caller_profile_id" bigint) RETURNS TABLE("post_id" "uuid", "body" "text", "timeline_pub_id" "text", "timeline_name" "text", "author_pub_id" "text", "author_name" "text", "author_avatar_path" "text", "activity_kind" "public"."profile_media_activity_kind", "activity_media_path" "text", "visibility" "public"."post_visibility", "published_at" timestamp with time zone, "edited_at" timestamp with time zone, "comment_count" integer, "reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction", "is_author" boolean, "can_edit" boolean, "can_delete" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "private"."read_profile_posts"("p_post_ids" "uuid"[], "p_caller_profile_id" bigint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."clear_comment_reaction"("p_comment_id" "uuid") RETURNS TABLE("reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."clear_comment_reaction"("p_comment_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."clear_post_reaction"("p_post_id" "uuid") RETURNS TABLE("reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."clear_post_reaction"("p_post_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."commit_group_post"("p_post_id" "uuid", "p_title" "text", "p_body" "text", "p_attachment_ids" "uuid"[], "p_publish" boolean DEFAULT false, "p_category_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null;
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
    and post.group_id = target_group_id and post.deleted_at is null
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
$$;

ALTER FUNCTION "public"."commit_group_post"("p_post_id" "uuid", "p_title" "text", "p_body" "text", "p_attachment_ids" "uuid"[], "p_publish" boolean, "p_category_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."commit_profile_post"("p_post_id" "uuid", "p_body" "text", "p_attachment_ids" "uuid"[], "p_publish" boolean DEFAULT false, "p_visibility" "public"."post_visibility" DEFAULT NULL::"public"."post_visibility") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  where post.id = p_post_id and post.kind = 'profile' and post.deleted_at is null
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
$$;

ALTER FUNCTION "public"."commit_profile_post"("p_post_id" "uuid", "p_body" "text", "p_attachment_ids" "uuid"[], "p_publish" boolean, "p_visibility" "public"."post_visibility") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_group_category"("p_group_id" "uuid", "p_name" "text", "p_position" integer DEFAULT NULL::integer) RETURNS "public"."group_categories"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."create_group_category"("p_group_id" "uuid", "p_name" "text", "p_position" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_group_post"("p_group_id" "uuid", "p_title" "text", "p_body" "text", "p_author_identity" "public"."post_identity", "p_category_id" "uuid" DEFAULT NULL::"uuid", "p_publish" boolean DEFAULT true) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."create_group_post"("p_group_id" "uuid", "p_title" "text", "p_body" "text", "p_author_identity" "public"."post_identity", "p_category_id" "uuid", "p_publish" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."restrict_group_anonymous_activity"("p_source_kind" "text", "p_source_id" "uuid", "p_reason" "text", "p_duration_days" integer) RETURNS TABLE("restriction_id" "uuid", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
      and post.published_at is not null and post.deleted_at is null;
  else
    select post.group_id, author.profile_id into target_group_id, target_profile_id
    from public.post_comments as comment
    join public.posts as post on post.id = comment.post_id and post.kind = 'group'
      and post.published_at is not null and post.deleted_at is null
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
$$;

ALTER FUNCTION "public"."restrict_group_anonymous_activity"("p_source_kind" "text", "p_source_id" "uuid", "p_reason" "text", "p_duration_days" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."cancel_group_anonymous_activity_restriction"("p_source_kind" "text", "p_source_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
      and post.published_at is not null and post.deleted_at is null;
  else
    select post.group_id, author.profile_id into target_group_id, target_profile_id
    from public.post_comments as comment
    join public.posts as post on post.id = comment.post_id and post.kind = 'group'
      and post.published_at is not null and post.deleted_at is null
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
$$;

ALTER FUNCTION "public"."cancel_group_anonymous_activity_restriction"("p_source_kind" "text", "p_source_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_my_group_anonymous_activity_restriction"("p_group_id" "uuid") RETURNS TABLE("reason" "text", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."get_my_group_anonymous_activity_restriction"("p_group_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_post_comment"("p_post_id" "uuid", "p_body" "text", "p_author_identity" "public"."post_identity", "p_parent_comment_id" "uuid" DEFAULT NULL::"uuid", "p_image_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("comment_id" "uuid", "post_id" "uuid", "parent_comment_id" "uuid", "root_comment_id" "uuid", "depth" smallint, "body" "text", "author_identity" "public"."post_identity", "author_pub_id" "text", "author_name" "text", "author_avatar_path" "text", "author_label" "text", "created_at" timestamp with time zone, "edited_at" timestamp with time zone, "is_deleted" boolean, "is_effective_feed_bump" boolean, "is_author" boolean, "can_edit" boolean, "can_delete" boolean, "reply_count" integer, "reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction", "parent_author_label" "text", "can_moderate_anonymous" boolean, "anonymous_author_restricted" boolean, "anonymous_author_restriction_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    and post.deleted_at is null
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
$$;

ALTER FUNCTION "public"."create_post_comment"("p_post_id" "uuid", "p_body" "text", "p_author_identity" "public"."post_identity", "p_parent_comment_id" "uuid", "p_image_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_profile_post"("p_timeline_pub_id" "text", "p_visibility" "public"."post_visibility" DEFAULT 'public'::"public"."post_visibility") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."create_profile_post"("p_timeline_pub_id" "text", "p_visibility" "public"."post_visibility") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."delete_group_category"("p_category_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."delete_group_category"("p_category_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."delete_group_post"("p_post_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null
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
  update public.posts set deleted_at = now(), pinned_at = null where id = p_post_id;
  update public.post_attachments
  set status = 'deleted', deleted_at = now()
  where post_id = p_post_id and status <> 'deleted';
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
$$;

ALTER FUNCTION "public"."delete_group_post"("p_post_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."delete_post_attachment"("p_attachment_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."delete_post_attachment"("p_attachment_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."delete_post_comment"("p_comment_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."delete_post_comment"("p_comment_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."delete_profile_post"("p_post_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  where post.id = p_post_id and post.kind = 'profile' and post.deleted_at is null
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

  update public.posts set deleted_at = now() where id = p_post_id;
  update public.post_attachments
  set status = 'deleted', deleted_at = now()
  where post_id = p_post_id and status <> 'deleted';
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
$$;

ALTER FUNCTION "public"."delete_profile_post"("p_post_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."finalize_comment_image"("p_image_id" "uuid") RETURNS "public"."comment_images"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."finalize_comment_image"("p_image_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."finalize_post_attachment"("p_attachment_id" "uuid") RETURNS "public"."post_attachments"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  if attachment.status <> 'pending' then
    raise exception 'attachment is not pending' using errcode = '55000';
  end if;
  select post.published_at is not null into is_published
  from public.posts as post
  where post.id = attachment.post_id and post.deleted_at is null;
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
  if not is_published then
    update public.post_attachments
    set status = 'ready', ready_at = now()
    where id = p_attachment_id
    returning * into attachment;
  end if;
  return attachment;
end;
$$;

ALTER FUNCTION "public"."finalize_post_attachment"("p_attachment_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_group_post"("p_post_id" "uuid") RETURNS TABLE("post_id" "uuid", "group_id" "uuid", "category_id" "uuid", "category_name" "text", "title" "text", "body" "text", "author_identity" "public"."post_identity", "author_pub_id" "text", "author_name" "text", "author_avatar_path" "text", "author_label" "text", "is_pinned" boolean, "published_at" timestamp with time zone, "edited_at" timestamp with time zone, "comment_count" integer, "reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction", "is_author" boolean, "can_edit" boolean, "can_delete" boolean, "can_pin" boolean, "can_moderate_anonymous" boolean, "anonymous_author_restricted" boolean, "anonymous_author_restriction_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    and post.published_at is not null and post.deleted_at is null;
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
    and post.published_at is not null and post.deleted_at is null;
end;
$$;

ALTER FUNCTION "public"."get_group_post"("p_post_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_profile_post"("p_post_id" "uuid") RETURNS TABLE("post_id" "uuid", "body" "text", "timeline_pub_id" "text", "timeline_name" "text", "author_pub_id" "text", "author_name" "text", "author_avatar_path" "text", "activity_kind" "public"."profile_media_activity_kind", "activity_media_path" "text", "visibility" "public"."post_visibility", "published_at" timestamp with time zone, "edited_at" timestamp with time zone, "comment_count" integer, "reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction", "is_author" boolean, "can_edit" boolean, "can_delete" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.posts as post
    where post.id = p_post_id and post.kind = 'profile'
      and post.published_at is not null and post.deleted_at is null
  ) or not private.can_read_post(p_post_id) then
    return;
  end if;

  return query
  select entry.*
  from private.read_profile_posts(array[p_post_id], caller_profile_id) as entry;
end;
$$;

ALTER FUNCTION "public"."get_profile_post"("p_post_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_comment_images"("p_comment_ids" "uuid"[]) RETURNS TABLE("image_id" "uuid", "comment_id" "uuid", "post_id" "uuid", "storage_bucket" "text", "object_path" "text", "mime_type" "text", "size_bytes" bigint, "width" integer, "height" integer, "ready_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."list_comment_images"("p_comment_ids" "uuid"[]) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_comment_reactors"("p_comment_id" "uuid") RETURNS TABLE("reaction" "public"."post_reaction", "reactor_pub_id" "text", "reactor_name" "text", "reactor_avatar_path" "text", "reacted_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."list_comment_reactors"("p_comment_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_group_posts"("p_group_id" "uuid", "p_category_id" "uuid" DEFAULT NULL::"uuid", "p_cursor_published_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_cursor_post_id" "uuid" DEFAULT NULL::"uuid", "p_cursor_is_pinned" boolean DEFAULT NULL::boolean, "p_limit" integer DEFAULT 20) RETURNS TABLE("post_id" "uuid", "group_id" "uuid", "category_id" "uuid", "category_name" "text", "title" "text", "body" "text", "author_identity" "public"."post_identity", "author_pub_id" "text", "author_name" "text", "author_avatar_path" "text", "author_label" "text", "is_pinned" boolean, "published_at" timestamp with time zone, "edited_at" timestamp with time zone, "comment_count" integer, "reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction", "is_author" boolean, "can_edit" boolean, "can_delete" boolean, "can_pin" boolean, "can_moderate_anonymous" boolean, "anonymous_author_restricted" boolean, "anonymous_author_restriction_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    and post.published_at is not null and post.deleted_at is null
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
$$;

ALTER FUNCTION "public"."list_group_posts"("p_group_id" "uuid", "p_category_id" "uuid", "p_cursor_published_at" timestamp with time zone, "p_cursor_post_id" "uuid", "p_cursor_is_pinned" boolean, "p_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_post_attachments"("p_post_id" "uuid") RETURNS TABLE("attachment_id" "uuid", "post_id" "uuid", "storage_bucket" "text", "object_path" "text", "original_filename" "text", "position" integer, "mime_type" "text", "size_bytes" bigint, "width" integer, "height" integer, "status" "public"."post_attachment_status", "created_at" timestamp with time zone, "ready_at" timestamp with time zone)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."list_post_attachments"("p_post_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_post_comment_replies"("p_root_comment_id" "uuid") RETURNS TABLE("comment_id" "uuid", "post_id" "uuid", "parent_comment_id" "uuid", "root_comment_id" "uuid", "depth" smallint, "body" "text", "author_identity" "public"."post_identity", "author_pub_id" "text", "author_name" "text", "author_avatar_path" "text", "author_label" "text", "created_at" timestamp with time zone, "edited_at" timestamp with time zone, "is_deleted" boolean, "is_effective_feed_bump" boolean, "is_author" boolean, "can_edit" boolean, "can_delete" boolean, "reply_count" integer, "reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction", "parent_author_label" "text", "can_moderate_anonymous" boolean, "anonymous_author_restricted" boolean, "anonymous_author_restriction_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."list_post_comment_replies"("p_root_comment_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_post_comments"("p_post_id" "uuid", "p_cursor_created_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_cursor_comment_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 20) RETURNS TABLE("comment_id" "uuid", "post_id" "uuid", "parent_comment_id" "uuid", "root_comment_id" "uuid", "depth" smallint, "body" "text", "author_identity" "public"."post_identity", "author_pub_id" "text", "author_name" "text", "author_avatar_path" "text", "author_label" "text", "created_at" timestamp with time zone, "edited_at" timestamp with time zone, "is_deleted" boolean, "is_effective_feed_bump" boolean, "is_author" boolean, "can_edit" boolean, "can_delete" boolean, "reply_count" integer, "reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction", "parent_author_label" "text", "can_moderate_anonymous" boolean, "anonymous_author_restricted" boolean, "anonymous_author_restriction_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."list_post_comments"("p_post_id" "uuid", "p_cursor_created_at" timestamp with time zone, "p_cursor_comment_id" "uuid", "p_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_post_reactors"("p_post_id" "uuid") RETURNS TABLE("reaction" "public"."post_reaction", "reactor_pub_id" "text", "reactor_name" "text", "reactor_avatar_path" "text", "reacted_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."list_post_reactors"("p_post_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_profile_posts"("p_timeline_pub_id" "text", "p_cursor_published_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_cursor_post_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 20) RETURNS TABLE("post_id" "uuid", "body" "text", "timeline_pub_id" "text", "timeline_name" "text", "author_pub_id" "text", "author_name" "text", "author_avatar_path" "text", "activity_kind" "public"."profile_media_activity_kind", "activity_media_path" "text", "visibility" "public"."post_visibility", "published_at" timestamp with time zone, "edited_at" timestamp with time zone, "comment_count" integer, "reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction", "is_author" boolean, "can_edit" boolean, "can_delete" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
      and post.deleted_at is null
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
$$;

ALTER FUNCTION "public"."list_profile_posts"("p_timeline_pub_id" "text", "p_cursor_published_at" timestamp with time zone, "p_cursor_post_id" "uuid", "p_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."move_group_category"("p_category_id" "uuid", "p_direction" smallint) RETURNS SETOF "public"."group_categories"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."move_group_category"("p_category_id" "uuid", "p_direction" smallint) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_comment_image"("p_post_id" "uuid", "p_mime_type" "text", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) RETURNS "public"."comment_images"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."prepare_comment_image"("p_post_id" "uuid", "p_mime_type" "text", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_post_attachment"("p_post_id" "uuid", "p_original_filename" "text", "p_mime_type" "text", "p_size_bytes" bigint, "p_width" integer DEFAULT NULL::integer, "p_height" integer DEFAULT NULL::integer) RETURNS "public"."post_attachments"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  where post.id = p_post_id and post.deleted_at is null
  for update;
  if post_record.id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can add attachments' using errcode = '42501';
  end if;
  if (select count(*) from public.post_attachments
      where post_id = p_post_id and status <> 'deleted') >= 10 then
    raise exception 'a post can have at most 10 attachments' using errcode = '23514';
  end if;

  select coalesce(min(candidate), 0) into next_position
  from generate_series(0, 9) as candidate
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
$$;

ALTER FUNCTION "public"."prepare_post_attachment"("p_post_id" "uuid", "p_original_filename" "text", "p_mime_type" "text", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."publish_group_post"("p_post_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null;
  if target_group_id is null or not private.is_post_author(p_post_id) then
    raise exception 'only the author can publish this post' using errcode = '42501';
  end if;
  select post.* into post_record
  from public.posts as post
  where post.id = p_post_id and post.kind = 'group'
    and post.group_id = target_group_id and post.deleted_at is null;
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
    and post.group_id = target_group_id and post.deleted_at is null
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
$$;

ALTER FUNCTION "public"."publish_group_post"("p_post_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reorder_post_attachments"("p_post_id" "uuid", "p_attachment_ids" "uuid"[]) RETURNS SETOF "public"."post_attachments"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  active_count integer;
begin
  perform 1 from public.posts where id = p_post_id and deleted_at is null for update;
  if not found or not private.is_post_author(p_post_id) then
    raise exception 'only the author can reorder attachments' using errcode = '42501';
  end if;
  if p_attachment_ids is null
    or cardinality(p_attachment_ids) > 10
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
$$;

ALTER FUNCTION "public"."reorder_post_attachments"("p_post_id" "uuid", "p_attachment_ids" "uuid"[]) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."search_group_posts"("p_group_id" "uuid", "p_query" "text", "p_limit" integer DEFAULT 50) RETURNS TABLE("post_id" "uuid", "group_id" "uuid", "category_id" "uuid", "category_name" "text", "title" "text", "body" "text", "author_identity" "public"."post_identity", "author_pub_id" "text", "author_name" "text", "author_avatar_path" "text", "author_label" "text", "is_pinned" boolean, "published_at" timestamp with time zone, "edited_at" timestamp with time zone, "is_author" boolean, "can_edit" boolean, "can_delete" boolean, "can_pin" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    and post.published_at is not null and post.deleted_at is null
    and nullif(normalized_query, '') is not null
    and (
      post.search_text like '%' || normalized_query || '%'
      or profile.search_name like '%' || normalized_query || '%'
    )
  order by post.published_at desc, post.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50);
end;
$$;

ALTER FUNCTION "public"."search_group_posts"("p_group_id" "uuid", "p_query" "text", "p_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."set_comment_reaction"("p_comment_id" "uuid", "p_reaction" "public"."post_reaction") RETURNS TABLE("reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."set_comment_reaction"("p_comment_id" "uuid", "p_reaction" "public"."post_reaction") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."set_group_post_pinned"("p_post_id" "uuid", "p_pinned" boolean) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    and post.deleted_at is null
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
$$;

ALTER FUNCTION "public"."set_group_post_pinned"("p_post_id" "uuid", "p_pinned" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."set_post_reaction"("p_post_id" "uuid", "p_reaction" "public"."post_reaction") RETURNS TABLE("reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."set_post_reaction"("p_post_id" "uuid", "p_reaction" "public"."post_reaction") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."update_group_category"("p_category_id" "uuid", "p_name" "text", "p_position" integer) RETURNS "public"."group_categories"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."update_group_category"("p_category_id" "uuid", "p_name" "text", "p_position" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."update_group_post"("p_post_id" "uuid", "p_title" "text", "p_body" "text", "p_category_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_record public.posts;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;
  select post.* into post_record from public.posts as post
  where post.id = p_post_id and post.kind = 'group' and post.deleted_at is null
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
$$;

ALTER FUNCTION "public"."update_group_post"("p_post_id" "uuid", "p_title" "text", "p_body" "text", "p_category_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."update_post_comment"("p_comment_id" "uuid", "p_body" "text", "p_image_id" "uuid" DEFAULT NULL::"uuid", "p_remove_image" boolean DEFAULT false) RETURNS TABLE("comment_id" "uuid", "post_id" "uuid", "parent_comment_id" "uuid", "root_comment_id" "uuid", "depth" smallint, "body" "text", "author_identity" "public"."post_identity", "author_pub_id" "text", "author_name" "text", "author_avatar_path" "text", "author_label" "text", "created_at" timestamp with time zone, "edited_at" timestamp with time zone, "is_deleted" boolean, "is_effective_feed_bump" boolean, "is_author" boolean, "can_edit" boolean, "can_delete" boolean, "reply_count" integer, "reaction_count" integer, "top_reactions" "public"."post_reaction"[], "my_reaction" "public"."post_reaction", "parent_author_label" "text", "can_moderate_anonymous" boolean, "anonymous_author_restricted" boolean, "anonymous_author_restriction_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."update_post_comment"("p_comment_id" "uuid", "p_body" "text", "p_image_id" "uuid", "p_remove_image" boolean) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "private"."comment_post_context"("p_post_id" "uuid", "p_caller_profile_id" bigint, OUT "is_visible" boolean, OUT "post_kind" "public"."post_kind", OUT "caller_role" "public"."group_member_role", OUT "identity_policy" "public"."group_identity_policy", OUT "post_author_identity" "public"."post_identity") FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."read_post_comments"("p_comment_ids" "uuid"[], "p_caller_profile_id" bigint, "p_caller_role" "public"."group_member_role") FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."read_profile_posts"("p_post_ids" "uuid"[], "p_caller_profile_id" bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."clear_comment_reaction"("p_comment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."clear_comment_reaction"("p_comment_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."clear_post_reaction"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."clear_post_reaction"("p_post_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."commit_group_post"("p_post_id" "uuid", "p_title" "text", "p_body" "text", "p_attachment_ids" "uuid"[], "p_publish" boolean, "p_category_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."commit_group_post"("p_post_id" "uuid", "p_title" "text", "p_body" "text", "p_attachment_ids" "uuid"[], "p_publish" boolean, "p_category_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."commit_profile_post"("p_post_id" "uuid", "p_body" "text", "p_attachment_ids" "uuid"[], "p_publish" boolean, "p_visibility" "public"."post_visibility") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."commit_profile_post"("p_post_id" "uuid", "p_body" "text", "p_attachment_ids" "uuid"[], "p_publish" boolean, "p_visibility" "public"."post_visibility") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_group_category"("p_group_id" "uuid", "p_name" "text", "p_position" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_group_category"("p_group_id" "uuid", "p_name" "text", "p_position" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_group_post"("p_group_id" "uuid", "p_title" "text", "p_body" "text", "p_author_identity" "public"."post_identity", "p_category_id" "uuid", "p_publish" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_group_post"("p_group_id" "uuid", "p_title" "text", "p_body" "text", "p_author_identity" "public"."post_identity", "p_category_id" "uuid", "p_publish" boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."restrict_group_anonymous_activity"("p_source_kind" "text", "p_source_id" "uuid", "p_reason" "text", "p_duration_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restrict_group_anonymous_activity"("p_source_kind" "text", "p_source_id" "uuid", "p_reason" "text", "p_duration_days" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_group_anonymous_activity_restriction"("p_source_kind" "text", "p_source_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_group_anonymous_activity_restriction"("p_source_kind" "text", "p_source_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_my_group_anonymous_activity_restriction"("p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_group_anonymous_activity_restriction"("p_group_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_post_comment"("p_post_id" "uuid", "p_body" "text", "p_author_identity" "public"."post_identity", "p_parent_comment_id" "uuid", "p_image_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_post_comment"("p_post_id" "uuid", "p_body" "text", "p_author_identity" "public"."post_identity", "p_parent_comment_id" "uuid", "p_image_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_profile_post"("p_timeline_pub_id" "text", "p_visibility" "public"."post_visibility") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_profile_post"("p_timeline_pub_id" "text", "p_visibility" "public"."post_visibility") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."delete_group_category"("p_category_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_group_category"("p_category_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."delete_group_post"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_group_post"("p_post_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."delete_post_attachment"("p_attachment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_post_attachment"("p_attachment_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."delete_post_comment"("p_comment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_post_comment"("p_comment_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."delete_profile_post"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_profile_post"("p_post_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."finalize_comment_image"("p_image_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_comment_image"("p_image_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."finalize_post_attachment"("p_attachment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_post_attachment"("p_attachment_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_group_post"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_group_post"("p_post_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_profile_post"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_profile_post"("p_post_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_comment_images"("p_comment_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_comment_images"("p_comment_ids" "uuid"[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_comment_reactors"("p_comment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_comment_reactors"("p_comment_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_group_posts"("p_group_id" "uuid", "p_category_id" "uuid", "p_cursor_published_at" timestamp with time zone, "p_cursor_post_id" "uuid", "p_cursor_is_pinned" boolean, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_group_posts"("p_group_id" "uuid", "p_category_id" "uuid", "p_cursor_published_at" timestamp with time zone, "p_cursor_post_id" "uuid", "p_cursor_is_pinned" boolean, "p_limit" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_post_attachments"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_post_attachments"("p_post_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_post_comment_replies"("p_root_comment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_post_comment_replies"("p_root_comment_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_post_comments"("p_post_id" "uuid", "p_cursor_created_at" timestamp with time zone, "p_cursor_comment_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_post_comments"("p_post_id" "uuid", "p_cursor_created_at" timestamp with time zone, "p_cursor_comment_id" "uuid", "p_limit" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_post_reactors"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_post_reactors"("p_post_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_profile_posts"("p_timeline_pub_id" "text", "p_cursor_published_at" timestamp with time zone, "p_cursor_post_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_profile_posts"("p_timeline_pub_id" "text", "p_cursor_published_at" timestamp with time zone, "p_cursor_post_id" "uuid", "p_limit" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."move_group_category"("p_category_id" "uuid", "p_direction" smallint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."move_group_category"("p_category_id" "uuid", "p_direction" smallint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_comment_image"("p_post_id" "uuid", "p_mime_type" "text", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_comment_image"("p_post_id" "uuid", "p_mime_type" "text", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_post_attachment"("p_post_id" "uuid", "p_original_filename" "text", "p_mime_type" "text", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_post_attachment"("p_post_id" "uuid", "p_original_filename" "text", "p_mime_type" "text", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."publish_group_post"("p_post_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_group_post"("p_post_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."reorder_post_attachments"("p_post_id" "uuid", "p_attachment_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_post_attachments"("p_post_id" "uuid", "p_attachment_ids" "uuid"[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."search_group_posts"("p_group_id" "uuid", "p_query" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_group_posts"("p_group_id" "uuid", "p_query" "text", "p_limit" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_comment_reaction"("p_comment_id" "uuid", "p_reaction" "public"."post_reaction") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_comment_reaction"("p_comment_id" "uuid", "p_reaction" "public"."post_reaction") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_group_post_pinned"("p_post_id" "uuid", "p_pinned" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_group_post_pinned"("p_post_id" "uuid", "p_pinned" boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_post_reaction"("p_post_id" "uuid", "p_reaction" "public"."post_reaction") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_post_reaction"("p_post_id" "uuid", "p_reaction" "public"."post_reaction") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_group_category"("p_category_id" "uuid", "p_name" "text", "p_position" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_group_category"("p_category_id" "uuid", "p_name" "text", "p_position" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_group_post"("p_post_id" "uuid", "p_title" "text", "p_body" "text", "p_category_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_group_post"("p_post_id" "uuid", "p_title" "text", "p_body" "text", "p_category_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_post_comment"("p_comment_id" "uuid", "p_body" "text", "p_image_id" "uuid", "p_remove_image" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_post_comment"("p_comment_id" "uuid", "p_body" "text", "p_image_id" "uuid", "p_remove_image" boolean) TO "authenticated";
