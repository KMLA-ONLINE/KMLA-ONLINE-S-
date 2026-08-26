-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

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
      and post.deleted_at is null
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