-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

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