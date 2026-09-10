-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.commit_group_post (
  p_post_id         uuid,
  p_title           text,
  p_body            text,
  p_attachment_ids  uuid[],
  p_publish         boolean DEFAULT false,
  p_category_id     uuid    DEFAULT NULL::uuid,
  p_mention_pub_ids text[]  DEFAULT '{}'::text[]
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
  content_changed boolean;
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
  where group_data.id = target_group_id
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

  -- 카테고리 이동은 수정이 아니다. 글의 내용은 그대로고 분류만 바뀐다 — 개인 게시물에서
  -- 공개 범위를 세지 않는 것과 같은 취급이다(`commit_profile_post`). 첨부를 재배치하기 전에
  -- 재어 두어야 원래 순서와 비교할 수 있다(`apply_post_commit`이 position과 status를 갈아엎는다).
  --
  -- `ready`만 세는 것이 핵심이다. 게시된 글에서 `finalize_post_attachment`는 새 첨부를
  -- `pending`으로 남기므로 `ready`가 곧 "이번 편집 전부터 있던 것"이다. `status <> 'deleted'`로
  -- 세면 방금 올린 첨부까지 들어가 양쪽 배열이 같아지고, 사진만 더한 수정이 수정이 아닌 것이
  -- 된다.
  content_changed := btrim(p_title) is distinct from post_record.title
    or coalesce(p_body, '') is distinct from post_record.body
    or coalesce(p_attachment_ids, '{}'::uuid[]) is distinct from (
      select coalesce(array_agg(attachment.id order by attachment.position), '{}'::uuid[])
      from public.post_attachments as attachment
      where attachment.post_id = p_post_id and attachment.status = 'ready'
    );

  perform private.apply_post_commit(p_post_id, p_body, p_attachment_ids);
  update public.posts
  set title = btrim(p_title), body = coalesce(p_body, ''), category_id = p_category_id,
    published_at = case when coalesce(p_publish, false) then now() else published_at end,
    edited_at = case
      -- 지금 게시하는 글은 수정된 적이 없다.
      when published_at is null then null
      when content_changed then now()
      else edited_at
    end
  where id = p_post_id;
  -- 게시 시각을 세운 다음에 부른다. 새 멘션 행의 트리거가 이미 게시된 게시물을 보아야 알림이
  -- 나가기 때문이다. 미게시 초안의 멘션은 `p_publish`가 참인 커밋에서 함께 알린다.
  perform private.sync_post_mentions(p_post_id, coalesce(p_body, ''), p_mention_pub_ids);
  return p_post_id;
end;
$function$;