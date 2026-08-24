create type public.group_post_report_reason as enum (
  'abuse',
  'sexual',
  'privacy',
  'impersonation',
  'spam',
  'other'
);

create table private.group_post_reports (
  id bigint generated always as identity primary key,
  post_id uuid not null
    references public.posts(id)
    on delete cascade,
  reporter_profile_id bigint not null
    references public.profiles(id)
    on delete cascade,
  reason public.group_post_report_reason not null,
  description text,
  created_at timestamptz not null default now(),

  constraint group_post_reports_unique_reporter
    unique (post_id, reporter_profile_id),

  constraint group_post_reports_description_length
    check (
      description is null
      or char_length(description) between 5 and 300
    ),

  constraint group_post_reports_other_description
    check (
      reason <> 'other'
      or description is not null
    )
);

create index group_post_reports_post_order_idx
on private.group_post_reports (
  post_id,
  created_at desc,
  id desc
);

revoke all
on table private.group_post_reports
from public, anon, authenticated;


create function public.report_group_post(
  p_post_id uuid,
  p_reason public.group_post_report_reason,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
    and post.published_at is not null
    and post.deleted_at is null;

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
$$;


create function public.list_group_post_report_summaries(
  p_group_id uuid,
  p_sort text default 'count',
  p_cursor_report_count bigint default null,
  p_cursor_latest_at timestamptz default null,
  p_cursor_post_id uuid default null,
  p_limit integer default 20
)
returns table (
  post_id uuid,
  title text,
  body_preview text,
  author_identity public.post_identity,
  author_pub_id text,
  author_name text,
  author_avatar_path text,
  author_label text,
  report_count bigint,
  description_count bigint,
  abuse_count bigint,
  sexual_count bigint,
  privacy_count bigint,
  impersonation_count bigint,
  spam_count bigint,
  other_count bigint,
  latest_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  with aggregated as (
    select
      report.post_id,
      count(*)::bigint as report_count,
      count(report.description)::bigint as description_count,
      count(*) filter (
        where report.reason = 'abuse'
      )::bigint as abuse_count,
      count(*) filter (
        where report.reason = 'sexual'
      )::bigint as sexual_count,
      count(*) filter (
        where report.reason = 'privacy'
      )::bigint as privacy_count,
      count(*) filter (
        where report.reason = 'impersonation'
      )::bigint as impersonation_count,
      count(*) filter (
        where report.reason = 'spam'
      )::bigint as spam_count,
      count(*) filter (
        where report.reason = 'other'
      )::bigint as other_count,
      max(report.created_at) as latest_at
    from private.group_post_reports as report
    join public.posts as post
      on post.id = report.post_id
    where post.group_id = p_group_id
      and post.kind = 'group'
      and post.published_at is not null
      and post.deleted_at is null
    group by report.post_id
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
        when group_record.identity_policy = 'always_anonymous'
          or post.author_identity = 'anonymous'
          then null
        else author_profile.pub_id
      end as author_pub_id,

      case
        when group_record.identity_policy = 'always_anonymous'
          or post.author_identity = 'anonymous'
          then null
        else author_profile.name
      end as author_name,

      case
        when group_record.identity_policy = 'always_anonymous'
          or post.author_identity = 'anonymous'
          then null
        else author_profile.avatar_path
      end as author_avatar_path,

      case
        when group_record.identity_policy = 'always_anonymous'
          then case
            when post.author_identity = 'staff'
              then '운영진'
            else '익명'
          end
        when post.author_identity = 'anonymous'
          then '익명'
        when post.author_identity = 'staff'
          then '운영진'
        else coalesce(author_profile.name, '알 수 없음')
      end as author_label,

      aggregated.report_count,
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
    join public.groups as group_record
      on group_record.id = post.group_id

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
$$;


create function public.list_group_post_report_descriptions(
  p_group_id uuid,
  p_post_id uuid,
  p_before_created_at timestamptz default null,
  p_before_report_id bigint default null,
  p_limit integer default 8
)
returns table (
  report_id bigint,
  reason public.group_post_report_reason,
  description text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
      and post.deleted_at is null
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
  where report.post_id = p_post_id
    and report.description is not null
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
$$;


create function private.cleanup_group_post_reports()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.group_post_reports
  where post_id = new.id;

  return new;
end;
$$;

create trigger posts_cleanup_group_reports
after update of deleted_at
on public.posts
for each row
when (
  old.deleted_at is null
  and new.deleted_at is not null
)
execute function private.cleanup_group_post_reports();


revoke all
on function public.report_group_post(
  uuid,
  public.group_post_report_reason,
  text
)
from public, anon;

revoke all
on function public.list_group_post_report_summaries(
  uuid,
  text,
  bigint,
  timestamptz,
  uuid,
  integer
)
from public, anon;

revoke all
on function public.list_group_post_report_descriptions(
  uuid,
  uuid,
  timestamptz,
  bigint,
  integer
)
from public, anon;

grant execute
on function public.report_group_post(
  uuid,
  public.group_post_report_reason,
  text
)
to authenticated;

grant execute
on function public.list_group_post_report_summaries(
  uuid,
  text,
  bigint,
  timestamptz,
  uuid,
  integer
)
to authenticated;

grant execute
on function public.list_group_post_report_descriptions(
  uuid,
  uuid,
  timestamptz,
  bigint,
  integer
)
to authenticated;
