create type public.post_kind as enum ('group', 'profile');
create type public.post_identity as enum ('identified', 'anonymous', 'staff');
create type public.post_visibility as enum ('public', 'private');

alter table public.profiles
add column allow_timeline_posts boolean not null default true;

create table public.group_categories (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_categories_id_group_id_key unique (id, group_id),
  constraint group_categories_name_length check (
    char_length(btrim(name)) between 1 and 30
  ),
  constraint group_categories_position_nonnegative check (position >= 0)
);

create unique index group_categories_name_unique_idx
on public.group_categories (group_id, lower(btrim(name)));

create index group_categories_order_idx
on public.group_categories (group_id, position, id);

create trigger group_categories_set_updated_at
before update on public.group_categories
for each row execute function private.set_updated_at();

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  kind public.post_kind not null,
  body text not null default '',
  body_format_version smallint not null default 1,
  group_id uuid references public.groups (id),
  timeline_profile_id bigint references public.profiles (id),
  title text,
  search_text text generated always as (
    lower(
      regexp_replace(
        coalesce(title, '') || ' ' || body,
        '[[:space:]]+',
        '',
        'g'
      )
    )
  ) stored,
  category_id uuid,
  author_identity public.post_identity not null,
  display_author_profile_id bigint references public.profiles (id),
  visibility public.post_visibility,
  pinned_at timestamptz,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint posts_category_group_fkey
    foreign key (category_id, group_id)
    references public.group_categories (id, group_id)
    on delete set null (category_id),
  constraint posts_body_length check (char_length(body) <= 20000),
  constraint posts_body_format_version_supported check (body_format_version = 1),
  constraint posts_title_length check (
    title is null or char_length(btrim(title)) between 1 and 100
  ),
  constraint posts_display_author_shape check (
    (author_identity = 'identified' and display_author_profile_id is not null)
    or (
      author_identity in ('anonymous', 'staff')
      and display_author_profile_id is null
    )
  ),
  constraint posts_kind_shape check (
    (
      kind = 'group'
      and group_id is not null
      and timeline_profile_id is null
      and title is not null
      and visibility is null
    )
    or (
      kind = 'profile'
      and group_id is null
      and timeline_profile_id is not null
      and title is null
      and category_id is null
      and author_identity = 'identified'
      and visibility is not null
      and pinned_at is null
    )
  ),
  constraint posts_private_profile_owner check (
    kind <> 'profile'
    or visibility <> 'private'
    or display_author_profile_id = timeline_profile_id
  ),
  constraint posts_publication_timestamps check (
    (published_at is null or published_at >= created_at)
    and (edited_at is null or (published_at is not null and edited_at >= published_at))
    and (deleted_at is null or (published_at is not null and deleted_at >= published_at))
    and (pinned_at is null or (published_at is not null and pinned_at >= published_at))
  )
);

create index posts_group_recent_idx
on public.posts (group_id, published_at desc, id desc)
where kind = 'group'
  and published_at is not null
  and deleted_at is null;

create index posts_group_pinned_idx
on public.posts (group_id, published_at desc, id desc)
where kind = 'group'
  and pinned_at is not null
  and deleted_at is null;

create index posts_public_profile_feed_idx
on public.posts (published_at desc, id desc)
where kind = 'profile'
  and visibility = 'public'
  and published_at is not null
  and deleted_at is null;

create index posts_timeline_idx
on public.posts (timeline_profile_id, published_at desc, id desc)
where kind = 'profile'
  and published_at is not null
  and deleted_at is null;

create index posts_category_recent_idx
on public.posts (group_id, category_id, published_at desc, id desc)
where kind = 'group'
  and category_id is not null
  and published_at is not null
  and deleted_at is null;

create index posts_display_author_idx
on public.posts (display_author_profile_id, published_at desc, id desc)
where display_author_profile_id is not null;

create index posts_group_search_idx
on public.posts using gin (search_text extensions.gin_trgm_ops)
where kind = 'group'
  and published_at is not null
  and deleted_at is null;

create table private.post_authors (
  post_id uuid primary key references public.posts (id) on delete cascade,
  profile_id bigint not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index post_authors_profile_idx
on private.post_authors (profile_id, post_id);

alter table public.group_categories enable row level security;
alter table public.posts enable row level security;
alter table private.post_authors enable row level security;

revoke all on table public.group_categories from anon, authenticated;
revoke all on table public.posts from anon, authenticated;
revoke all on table private.post_authors from anon, authenticated;
