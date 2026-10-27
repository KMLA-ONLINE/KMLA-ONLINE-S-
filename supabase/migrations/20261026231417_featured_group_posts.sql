SET local check_function_bodies = off;

ALTER TABLE "public"."posts"
  DROP CONSTRAINT "posts_kind_shape";

ALTER TABLE "public"."posts"
  DROP CONSTRAINT "posts_publication_timestamps";

DROP FUNCTION "public"."get_group_post"(uuid);

DROP FUNCTION "public"."list_group_posts"(uuid, uuid, timestamp WITH time zone, uuid, boolean, integer);

ALTER TABLE "public"."posts"
  ADD COLUMN "featured_at" timestamp WITH time zone;

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
    is_featured                             boolean,
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
    anonymous_author_restriction_expires_at timestamp with time zone,
    mentions                                jsonb
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
    post.pinned_at is not null, post.featured_at is not null, post.published_at, post.edited_at,
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
    active_restriction.expires_at,
    private.post_mentions_json(post.id)
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

REVOKE ALL ON FUNCTION "public"."get_group_post"(uuid) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.list_group_featured_posts (
  p_group_id uuid
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
    is_featured                             boolean,
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
    anonymous_author_restriction_expires_at timestamp with time zone,
    mentions                                jsonb,
    attachments                             jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  -- 대표 게시물은 카테고리 필터와 커서를 받지 않는다. 그룹당 10개가 상한이라(§8.18) 한 페이지다.
  return query
  select * from public.list_group_posts(p_group_id, null, null, null, null, 10, true);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_group_featured_posts"(uuid) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.list_group_posts (
  p_group_id            uuid,
  p_category_id         uuid                     DEFAULT NULL::uuid,
  p_cursor_published_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_cursor_post_id      uuid                     DEFAULT NULL::uuid,
  p_cursor_is_pinned    boolean                  DEFAULT NULL::boolean,
  p_limit               integer                  DEFAULT 20,
  p_featured_only       boolean                  DEFAULT false
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
    is_featured                             boolean,
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
    anonymous_author_restriction_expires_at timestamp with time zone,
    mentions                                jsonb,
    attachments                             jsonb
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
    post.pinned_at is not null, post.featured_at is not null, post.published_at, post.edited_at,
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
    active_restriction.expires_at,
    private.post_mentions_json(post.id),
    private.post_attachments_json(post.id)
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
    and (not p_featured_only or post.featured_at is not null)
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
  -- 대표 목록은 최근 지정한 순서다. 일반 목록에서는 이 키가 전부 null이라 다음 키로 넘어간다.
  order by
    case when p_featured_only then post.featured_at end desc,
    (post.pinned_at is not null) desc, post.published_at desc, post.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_group_posts"(uuid, uuid, timestamp WITH time zone, uuid, boolean, integer, boolean) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.set_group_post_featured (
  p_post_id  uuid,
  p_featured boolean
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_profile_id bigint := private.current_profile_id();
  post_group_id uuid;
  featured_count integer;
begin
  if auth.uid() is null or caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  select post.group_id into post_group_id
  from public.posts as post
  where post.id = p_post_id
    and post.kind = 'group'
    and post.published_at is not null;

  if post_group_id is null or not exists (
    select 1 from public.group_memberships as membership
    where membership.group_id = post_group_id
      and membership.profile_id = caller_profile_id
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'post featuring is not allowed' using errcode = '42501';
  end if;

  if p_featured then
    -- 상한은 그룹 단위라 그룹 행을 잠근 뒤 센다. 두 운영진이 동시에 10번째를 지정해도 11개가 되지 않는다.
    perform 1 from public.groups as grp where grp.id = post_group_id for update;
    select count(*)::integer into featured_count
    from public.posts as post
    where post.group_id = post_group_id
      and post.kind = 'group'
      and post.featured_at is not null
      and post.id <> p_post_id;
    if featured_count >= 10 then
      raise exception 'featured post limit reached' using errcode = 'P0001';
    end if;
  end if;

  -- 이미 대표인 글을 다시 지정하면 맨 앞으로 온다(기능 명세 §8.18). 순서가 지정 시각이므로 한 트랜잭션
  -- 안에서 두 번 불러도 구분되도록 트랜잭션 시작 시각(now())이 아니라 호출 시각을 쓴다.
  update public.posts
  set featured_at = case when p_featured then clock_timestamp() else null end
  where id = p_post_id;
  return p_post_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_group_post_featured"(uuid, boolean) FROM PUBLIC, "anon", "service_role";

ALTER TABLE "public"."posts"
  ADD CONSTRAINT "posts_kind_shape" CHECK ((((kind = 'group'::public.post_kind) AND (group_id IS NOT NULL) AND (timeline_profile_id IS NULL) AND (title IS
    NOT NULL) AND (visibility IS NULL)) OR ((kind = 'profile'::public.post_kind) AND (group_id IS NULL) AND (timeline_profile_id IS
    NOT NULL) AND (title IS NULL) AND (category_id IS NULL) AND (author_identity = 'identified'::public.post_identity) AND (visibility IS
    NOT NULL) AND (pinned_at IS NULL) AND (featured_at IS NULL))));

ALTER TABLE "public"."posts"
  ADD CONSTRAINT "posts_publication_timestamps" CHECK ((((published_at IS NULL) OR (published_at >= created_at)) AND ((edited_at IS NULL) OR ((published_at IS
    NOT NULL) AND (edited_at >= published_at))) AND ((pinned_at IS NULL) OR ((published_at IS
    NOT NULL) AND (pinned_at >= published_at))) AND ((featured_at IS NULL) OR ((published_at IS NOT NULL) AND (featured_at >= published_at)))));

CREATE INDEX posts_group_featured_idx ON public.posts USING btree (group_id, featured_at DESC, id DESC)
  WHERE ((kind = 'group'::public.post_kind) AND (featured_at IS NOT NULL));

GRANT EXECUTE ON FUNCTION "public"."get_group_post"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_group_post"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_group_post"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_group_featured_posts"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_group_featured_posts"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_group_featured_posts"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_group_posts"(uuid, uuid, timestamp WITH time zone, uuid, boolean, integer, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_group_posts"(uuid, uuid, timestamp WITH time zone, uuid, boolean, integer, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_group_posts"(uuid, uuid, timestamp WITH time zone, uuid, boolean, integer, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_group_post_featured"(uuid, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_group_post_featured"(uuid, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_group_post_featured"(uuid, boolean) TO "postgres";
