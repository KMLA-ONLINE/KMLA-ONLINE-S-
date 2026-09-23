begin;

create extension if not exists pgtap with schema extensions;
select plan(58);

-- 시드에는 로그인 가능한 계정이 하나뿐이라 타임라인 당사자·작성자·제3자를 함께 볼 수 없다.
-- 시드를 건드리지 않고 트랜잭션 안에서만 두 계정을 더 붙인다.
--   auth1 = 시드 학생(홍길동). 타임라인 당사자
--   auth2 = hanbyeol-25(이한별). 남의 타임라인에 쓰는 작성자
--   auth3 = saebyeok-24(박새벽). 제3자
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'writer@kmla.hs.kr', '', now(),
    '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003',
    'authenticated', 'authenticated', 'bystander@kmla.hs.kr', '', now(),
    '', '', '', '', '', '', '', '', '{}', '{}', now(), now()
  );

update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000002'
where pub_id = 'hanbyeol-25';
update public.profiles
set auth_user_id = '10000000-0000-0000-0000-000000000003'
where pub_id = 'saebyeok-24';

create temp table ids (name text primary key, id uuid);
create temp table owners (name text primary key, pub_id text);
grant select, insert on table ids to authenticated;
insert into owners (name, pub_id)
select 'timeline', profile.pub_id
from public.profiles as profile
where profile.auth_user_id = '10000000-0000-0000-0000-000000000001';
insert into owners (name, pub_id)
select 'writer', 'hanbyeol-25';
grant select on table owners to anon, authenticated;

set local role anon;
select throws_ok(
  $$select * from public.list_profile_posts(
      (select pub_id from owners where name = 'timeline')
    )$$,
  '42501', null, 'anonymous visitors cannot read a timeline'
);
reset role;

-- 타임라인 당사자: 자기 타임라인에 비공개 글을 쓴다 (기능 명세 §8.4).
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

insert into ids (name, id)
select 'private', public.create_profile_post(
  (select pub_id from owners where name = 'timeline'), 'private'
);
select lives_ok(
  $$select public.commit_profile_post(
      (select id from ids where name = 'private'), '나만 보는 메모', '{}'::uuid[], true
    )$$,
  'the timeline owner publishes a private post on their own timeline'
);
select is(
  (
    select visibility
    from public.get_profile_post((select id from ids where name = 'private'))
  ),
  'private'::public.post_visibility,
  'the private post keeps its visibility'
);
select is(
  (
    select count(*)
    from public.list_profile_posts(
      (select pub_id from owners where name = 'timeline')
    )
  ),
  1::bigint,
  'the timeline owner sees their own private post'
);

-- 게시물 또는 준비된 첨부가 하나는 있어야 한다 (기능 명세 §8.3).
insert into ids (name, id)
select 'empty', public.create_profile_post(
  (select pub_id from owners where name = 'timeline'), 'public'
);
select throws_ok(
  $$select public.commit_profile_post(
      (select id from ids where name = 'empty'), '   ', '{}'::uuid[], true
    )$$,
  '22023', 'post requires a body or ready attachment',
  'an empty profile post cannot be published'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is(
  (
    select count(*)
    from public.list_profile_posts(
      (select pub_id from owners where name = 'timeline')
    )
  ),
  0::bigint,
  'another user does not see the private post on that timeline'
);
select is(
  (
    select count(*)
    from public.get_profile_post((select id from ids where name = 'private'))
  ),
  0::bigint,
  'another user cannot open the private post directly'
);
select throws_ok(
  $$select * from public.create_post_comment(
      (select id from ids where name = 'private'), '남의 비공개 글', 'identified'
    )$$,
  '42501', 'post is not accessible', 'only the author comments on a private post'
);
select throws_ok(
  $$select public.set_post_reaction(
      (select id from ids where name = 'private'), 'like'
    )$$,
  '42501', 'post is not accessible', 'only the author reacts to a private post'
);

-- 타인 타임라인 글은 비공개를 골라도 즉시 전체 공개다 (기능 명세 §8.4).
insert into ids (name, id)
select 'guest', public.create_profile_post(
  (select pub_id from owners where name = 'timeline'), 'private'
);
select lives_ok(
  $$select public.commit_profile_post(
      (select id from ids where name = 'guest'), '생일 축하해!', '{}'::uuid[], true, 'private'
    )$$,
  'a guest post on another timeline is published'
);
select is(
  (
    select visibility
    from public.get_profile_post((select id from ids where name = 'guest'))
  ),
  'public'::public.post_visibility,
  'a guest post is forced public even when private is requested'
);
select is(
  (
    select timeline_pub_id
    from public.get_profile_post((select id from ids where name = 'guest'))
  ),
  (select pub_id from owners where name = 'timeline'),
  'the guest post names the timeline owner'
);
select is(
  (
    select author_pub_id
    from public.get_profile_post((select id from ids where name = 'guest'))
  ),
  'hanbyeol-25',
  'the guest post names its author'
);
select is(
  (
    select can_edit
    from public.get_profile_post((select id from ids where name = 'guest'))
  ),
  true,
  'the author may edit their guest post'
);
select is(
  (
    select can_delete
    from public.get_profile_post((select id from ids where name = 'guest'))
  ),
  true,
  'the author may delete their guest post'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

-- 타임라인 당사자는 타인 글을 지울 수는 있어도 수정하지는 못한다 (기능 명세 §8.12, §12.4).
select ok(
  (
    select can_delete and not can_edit
    from public.get_profile_post((select id from ids where name = 'guest'))
  ),
  'the timeline owner may delete but not edit a guest post'
);
select throws_ok(
  $$select public.commit_profile_post(
      (select id from ids where name = 'guest'), '내가 고친 남의 글', '{}'::uuid[]
    )$$,
  '42501', 'only the author can commit this post',
  'the timeline owner cannot edit a guest post'
);

-- 공개 범위는 게시 후에도 작성자가 바꾼다 (기능 명세 §8.10).
-- 본문은 그대로 두고 공개 범위만 바꾼다. 아래 `edited_at` 검증이 이 조건에 달려 있다.
select lives_ok(
  $$select public.commit_profile_post(
      (select id from ids where name = 'private'), '나만 보는 메모', '{}'::uuid[], false, 'public'
    )$$,
  'the author changes their own post visibility after publishing'
);
select is(
  (
    select visibility
    from public.get_profile_post((select id from ids where name = 'private'))
  ),
  'public'::public.post_visibility,
  
  'the visibility change is stored'
);

-- 공개 범위만 바꾼 것은 수정이 아니다. 명세 §8.8이 게시물에 수정 표시를 두지 않기로 했으므로
-- 화면에 드러나지는 않지만, 기록까지 틀리게 둘 이유는 없다.
select is(
  (
    select edited_at
    from public.posts
    where id = (select id from ids where name = 'private')
  ),
  null::timestamptz,
  'changing only the visibility does not count as an edit'
);

select lives_ok(
  $$select public.commit_profile_post(
      (select id from ids where name = 'private'), '본문을 고쳤다', '{}'::uuid[]
    )$$,
  'the author edits the body of their own post'
);
select isnt(
  (
    select edited_at
    from public.posts
    where id = (select id from ids where name = 'private')
  ),
  null::timestamptz,
  'changing the body does count as an edit'
);

reset role;

-- 타인 작성 허용을 끄면 새 글만 막고 기존 글은 남는다 (기능 명세 §8.4). 설정을 바꾸는 경로
-- 자체는 `profile_edit`가 본다 — 여기서는 꺼진 상태의 효과만 확인한다.
update public.profiles
set allow_timeline_posts = false
where auth_user_id = '10000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select throws_ok(
  $$select public.create_profile_post(
      (select pub_id from owners where name = 'timeline')
    )$$,
  '42501', 'timeline owner does not accept posts',
  'a closed timeline rejects new guest posts'
);
select is(
  (
    select count(*)
    from public.list_profile_posts(
      (select pub_id from owners where name = 'timeline')
    )
  ),
  2::bigint,
  'closing the timeline keeps the posts already written there'
);
select throws_ok(
  $$select public.delete_profile_post((select id from ids where name = 'guest'))$$,
  '42501', 'post deletion is not allowed',
  'a bystander cannot delete a post from another timeline'
);

-- 전체 공개 개인 게시물에는 승인 사용자 전체가 실명으로 댓글과 반응을 남긴다
-- (기능 명세 §9.1, §10.1).
select lives_ok(
  $$select * from public.create_post_comment(
      (select id from ids where name = 'guest'), '축하해요!', 'identified'
    )$$,
  'any accepted user comments on a public profile post'
);
select throws_ok(
  $$select * from public.create_post_comment(
      (select id from ids where name = 'guest'), '익명 시도', 'anonymous'
    )$$,
  '42501', 'profile post comments must be identified',
  'profile post comments cannot be anonymous'
);
select throws_ok(
  $$select * from public.create_post_comment(
      (select id from ids where name = 'guest'), '운영진 사칭', 'staff'
    )$$,
  '42501', 'profile post comments must be identified',
  'profile post comments cannot use the staff identity'
);
select is(
  (
    select count(*)
    from public.list_post_comments((select id from ids where name = 'guest'))
  ),
  1::bigint,
  'the comment is listed on the profile post'
);
select is(
  (
    select can_delete
    from public.list_post_comments((select id from ids where name = 'guest'))
  ),
  true,
  'a comment author may delete their own comment'
);
select is(
  (
    select reaction_count
    from public.set_post_reaction((select id from ids where name = 'guest'), 'love')
  ),
  1,
  'any accepted user reacts to a public profile post'
);
reset role;

-- 반응 행은 통째로 신원이라 클라이언트에 select grant가 없다.
select is(
  (
    select count(*)
    from public.post_reactions as entry
    where entry.post_id = (select id from ids where name = 'guest')
  ),
  1::bigint,
  'profile post reactions use the ordinary reaction row shape'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

-- 타임라인 당사자는 자기 타임라인의 타인 댓글을 지울 수 없다. 그 권한은 그룹 운영진에게만
-- 있다 (기능 명세 §9.4).
select is(
  (
    select can_delete
    from public.list_post_comments((select id from ids where name = 'guest'))
  ),
  false,
  'the timeline owner cannot delete another user comment'
);

-- 개인 게시물은 그룹 게시물 검색에 포함하지 않는다 (기능 명세 §8.9).
select is(
  (
    select count(*)
    from public.search_group_posts(
      '20000000-0000-0000-0000-000000000001', '생일'
    )
  ),
  0::bigint,
  'profile posts never appear in group post search'
);

select lives_ok(
  $$select public.delete_profile_post((select id from ids where name = 'guest'))$$,
  'the timeline owner deletes a guest post from their timeline'
);
select is(
  (
    select count(*)
    from public.list_profile_posts(
      (select pub_id from owners where name = 'timeline')
    )
  ),
  1::bigint,
  'the deleted guest post leaves the timeline'
);

reset role;

-- 첨부 파이프라인을 실제 경로로 밟는다: 준비 → 업로드 → finalize → commit.
-- 행을 직접 넣어 읽기 정책만 확인하면, 쓰기 경로가 막혀 있어도 초록불이 켜진다. 실제로
-- `prepare_post_attachment`가 `kind = 'group'`에 묶여 개인 게시물의 첨부가 통째로 죽어 있었고
-- 그것을 이 파일이 잡지 못했다.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

insert into ids (name, id)
select 'photo', public.create_profile_post(
  (select pub_id from owners where name = 'timeline'), 'public'
);

select lives_ok(
  $$select public.prepare_post_attachment(
      (select id from ids where name = 'photo'),
      'memo.webp', 'image/webp', 1024, 100, 100
    )$$,
  'a profile post accepts an attachment'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    select attachment.storage_bucket, attachment.object_path,
      '10000000-0000-0000-0000-000000000001',
      '{"size":1024,"mimetype":"image/webp"}'::jsonb
    from public.post_attachments as attachment
    where attachment.post_id = (select id from ids where name = 'photo')$$,
  'Storage accepts the prepared path for a profile post attachment'
);
select lives_ok(
  $$select public.finalize_post_attachment(
      (select attachment.id from public.post_attachments as attachment
       where attachment.post_id = (select id from ids where name = 'photo'))
    )$$,
  'the uploaded profile post attachment finalizes'
);

-- 본문 없이 첨부만으로도 게시할 수 있다 (기능 명세 §8.3).
select lives_ok(
  $$select public.commit_profile_post(
      (select id from ids where name = 'photo'),
      '',
      array(
        select attachment.id from public.post_attachments as attachment
        where attachment.post_id = (select id from ids where name = 'photo')
        order by attachment.position
      ),
      true
    )$$,
  'an attachment-only profile post publishes'
);
select is(
  (
    select count(*)
    from public.list_post_attachments((select id from ids where name = 'photo'))
  ),
  1::bigint,
  'the published profile post lists its attachment'
);
select is(
  (
    select edited_at
    from public.posts
    where id = (select id from ids where name = 'photo')
  ),
  null::timestamptz,
  'publishing does not mark the post edited'
);

-- 본문은 그대로 두고 사진만 하나 더한다. 게시된 글에서는 finalize가 `pending`을 유지하므로
-- 커밋 시점의 `ready` 집합이 편집 전 상태다.
select lives_ok(
  $$select public.prepare_post_attachment(
      (select id from ids where name = 'photo'),
      'second.webp', 'image/webp', 2048, 100, 100
    )$$,
  'a published profile post accepts another attachment'
);
insert into storage.objects (bucket_id, name, owner_id, metadata)
select attachment.storage_bucket, attachment.object_path,
  '10000000-0000-0000-0000-000000000001',
  '{"size":2048,"mimetype":"image/webp"}'::jsonb
from public.post_attachments as attachment
where attachment.post_id = (select id from ids where name = 'photo')
  and attachment.status = 'pending';
select lives_ok(
  $$select public.finalize_post_attachment(
      (select attachment.id from public.post_attachments as attachment
       where attachment.post_id = (select id from ids where name = 'photo')
         and attachment.status = 'pending')
    )$$,
  'the second upload finalizes on a published post'
);
select lives_ok(
  $$select public.commit_profile_post(
      (select id from ids where name = 'photo'),
      '',
      array(
        select attachment.id from public.post_attachments as attachment
        where attachment.post_id = (select id from ids where name = 'photo')
          and attachment.status <> 'deleted'
        order by attachment.position
      ),
      false
    )$$,
  'adding an attachment to a published profile post commits'
);
select isnt(
  (
    select edited_at
    from public.posts
    where id = (select id from ids where name = 'photo')
  ),
  null::timestamptz,
  'adding an attachment counts as an edit even when the body is untouched'
);

-- 첨부 읽기는 게시물 읽기 권한을 그대로 따른다 (STORAGE_BUCKETS.md §4.3).
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
-- signed URL 발급은 이 operation으로 들어온다. 정책이 operation을 보므로 함께 세운다.
select set_config('storage.operation', 'object.sign', true);
set local role authenticated;
select is(
  (
    select count(*)
    from public.post_attachments as attachment
    where attachment.post_id = (select id from ids where name = 'photo')
  ),
  2::bigint,
  'public profile post attachments are readable by any accepted user'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'post-attachments'),
  2::bigint,
  'public profile post objects can be signed by any accepted user'
);

reset role;
update public.posts
set visibility = 'private'
where id = (select id from ids where name = 'photo');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('storage.operation', 'object.sign', true);
set local role authenticated;
select is(
  (
    select count(*)
    from public.post_attachments as attachment
    where attachment.post_id = (select id from ids where name = 'photo')
  ),
  0::bigint,
  'private profile post attachments are hidden from other users'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'post-attachments'),
  0::bigint,
  'private profile post objects cannot be signed by other users'
);

reset role;

-- 타임라인 당사자가 사라지면 그 타임라인의 글도 함께 사라진다. 목록은 공개 ID를 accepted로
-- 찾으므로 원래 비지만, 직접 링크로 여는 경로가 따로 새지 않는지 본다.
update public.profiles
set status = 'blocked'
where auth_user_id = '10000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(
  (
    select count(*)
    from public.get_profile_post((select id from ids where name = 'private'))
  ),
  0::bigint,
  'a post on a deactivated timeline is not reachable by direct link'
);

reset role;
update public.profiles
set status = 'accepted'
where auth_user_id = '10000000-0000-0000-0000-000000000001';

-- 반환 모양이 바뀌면 drop 후 재생성해야 하고, 그때 grant를 빠뜨리면 런타임 42501이 된다.
select ok(
  has_function_privilege(
    'authenticated', 'public.list_profile_posts(text, timestamptz, uuid, integer)', 'execute'
  ),
  'authenticated may list a timeline'
);
select ok(
  has_function_privilege('authenticated', 'public.get_profile_post(uuid)', 'execute'),
  'authenticated may open a profile post'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.create_profile_post(text, public.post_visibility)', 'execute'
  ),
  'authenticated may start a profile post'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.commit_profile_post(uuid, text, uuid[], boolean, public.post_visibility)',
    'execute'
  ),
  'authenticated may commit a profile post'
);
select ok(
  has_function_privilege('authenticated', 'public.delete_profile_post(uuid)', 'execute'),
  'authenticated may delete a profile post'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.read_profile_posts(uuid[], bigint)', 'execute'
  ),
  'the shared projection stays out of client reach'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.apply_post_commit(uuid, text, uuid[])', 'execute'
  ),
  'the shared attachment commit stays out of client reach'
);

select * from finish();
rollback;
