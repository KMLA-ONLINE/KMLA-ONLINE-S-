-- 신고 무시: 운영진이 판단을 끝낸 게시물을 신고 탭에서 내린다. 신고 기록 자체는 지우지 않고
-- "이 시각까지의 신고는 처리했다"는 표시만 남기므로, 이후 새 신고가 들어오면 목록에 다시 뜬다.
create table private.group_post_report_dismissals (
  post_id uuid primary key
    references public.posts(id)
    on delete cascade,
  dismissed_by_profile_id bigint
    references public.profiles(id)
    on delete set null,
  dismissed_at timestamptz not null default now()
);

revoke all
on table private.group_post_report_dismissals
from public, anon, authenticated;


create function public.dismiss_group_post_reports(
  p_post_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
    and post.published_at is not null
    and post.deleted_at is null;

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
$$;


-- 반환 열이 늘어나므로 교체가 아니라 재생성한다.
drop function public.list_group_post_report_summaries(
  uuid,
  text,
  bigint,
  timestamptz,
  uuid,
  integer
);

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
  dismissed_count bigint,
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
      and post.deleted_at is null
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
$$;


-- 설명 목록도 무시 이후 신고만 돌려준다. 요약의 `description_count`와 어긋나지 않게 한다.
create or replace function public.list_group_post_report_descriptions(
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
$$;


create or replace function private.cleanup_group_post_reports()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.group_post_reports
  where post_id = new.id;

  delete from private.group_post_report_dismissals
  where post_id = new.id;

  return new;
end;
$$;


revoke all
on function public.dismiss_group_post_reports(uuid)
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

grant execute
on function public.dismiss_group_post_reports(uuid)
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
