-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


CREATE TYPE "public"."group_identity_policy" AS ENUM (
    'identified',
    'optional_anonymous'
);

ALTER TYPE "public"."group_identity_policy" OWNER TO "postgres";

CREATE TYPE "public"."group_join_policy" AS ENUM (
    'open',
    'request',
    'invite_only'
);

ALTER TYPE "public"."group_join_policy" OWNER TO "postgres";

CREATE TYPE "public"."group_kind" AS ENUM (
    'official',
    'unofficial'
);

ALTER TYPE "public"."group_kind" OWNER TO "postgres";

CREATE TYPE "public"."group_media_slot" AS ENUM (
    'icon',
    'cover'
);

ALTER TYPE "public"."group_media_slot" OWNER TO "postgres";

CREATE TYPE "public"."group_media_status" AS ENUM (
    'pending',
    'ready',
    'deleted'
);

ALTER TYPE "public"."group_media_status" OWNER TO "postgres";

CREATE TYPE "public"."group_member_role" AS ENUM (
    'owner',
    'admin',
    'manager',
    'member'
);

ALTER TYPE "public"."group_member_role" OWNER TO "postgres";

CREATE TYPE "public"."group_posting_policy" AS ENUM (
    'members',
    'staff'
);

ALTER TYPE "public"."group_posting_policy" OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."assert_group_invite_manager"("p_group_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "private"."assert_group_invite_manager"("p_group_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."can_manage_group"("p_group_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select auth.uid() is not null and exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = private.current_profile_id()
      and membership.role in ('owner', 'admin')
  );
$$;

ALTER FUNCTION "private"."can_manage_group"("p_group_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."can_read_group_media"("p_object_path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "private"."can_read_group_media"("p_object_path" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."can_upload_group_media"("p_object_path" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.group_media_objects as media
    where media.object_path = p_object_path
      and media.status = 'pending'
      and private.can_manage_group(media.group_id)
  );
$$;

ALTER FUNCTION "private"."can_upload_group_media"("p_object_path" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."claim_group_media_cleanup"("p_limit" integer DEFAULT 100, "p_lease_seconds" integer DEFAULT 300) RETURNS TABLE("media_id" "uuid", "object_path" "text", "lease_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_limit not between 1 and 500 or p_lease_seconds not between 30 and 3600 then
    raise exception 'invalid cleanup lease parameters' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select media.id
    from public.group_media_objects as media
    where (
        (media.status = 'pending' and media.created_at <= now() - interval '48 hours')
        or media.status = 'deleted'
      )
      and (media.cleanup_lease_expires_at is null or media.cleanup_lease_expires_at <= now())
    order by media.created_at, media.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.group_media_objects as media
    set cleanup_lease_id = gen_random_uuid(),
      cleanup_lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from candidates
    where media.id = candidates.id
    returning media.id, media.object_path, media.cleanup_lease_id
  )
  select claimed.id, claimed.object_path, claimed.cleanup_lease_id from claimed;
end;
$$;

ALTER FUNCTION "private"."claim_group_media_cleanup"("p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."complete_group_media_cleanup"("p_media_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(p_object_deleted, false) then
    delete from public.group_media_objects
    where id = p_media_id
      and cleanup_lease_id = p_lease_id
      and cleanup_lease_expires_at > now()
      and (status = 'deleted' or (status = 'pending' and created_at <= now() - interval '48 hours'));
  else
    update public.group_media_objects
    set cleanup_lease_id = null, cleanup_lease_expires_at = null
    where id = p_media_id and cleanup_lease_id = p_lease_id;
  end if;
  return found;
end;
$$;

ALTER FUNCTION "private"."complete_group_media_cleanup"("p_media_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."initialize_group_memberships"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "private"."initialize_group_memberships"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."is_group_member"("p_group_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.group_memberships as membership
    where membership.group_id = p_group_id
      and membership.profile_id = private.current_profile_id()
  );
$$;

ALTER FUNCTION "private"."is_group_member"("p_group_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."lock_group_for_join_request"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "private"."lock_group_for_join_request"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."prevent_group_identity_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.id <> old.id
    or new.slug <> old.slug
    or new.slug_is_custom <> old.slug_is_custom
    or new.kind <> old.kind then
    raise exception 'group identity cannot be changed' using errcode = '55000';
  end if;

  return new;
end;
$$;

ALTER FUNCTION "private"."prevent_group_identity_changes"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."recount_group_members"("p_group_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  update public.groups as group_record
  set member_count = (
    select count(*)::bigint
    from public.group_memberships as membership
    where membership.group_id = p_group_id
  )
  where group_record.id = p_group_id;
$$;

ALTER FUNCTION "private"."recount_group_members"("p_group_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."sync_group_member_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "private"."sync_group_member_count"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "private"."sync_student_official_memberships"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "private"."sync_student_official_memberships"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."accept_group_invite"("p_token" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."accept_group_invite"("p_token" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."approve_group_join_request"("p_group_id" "uuid", "p_request_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."approve_group_join_request"("p_group_id" "uuid", "p_request_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."claim_group_media_cleanup"("p_limit" integer DEFAULT 100, "p_lease_seconds" integer DEFAULT 300) RETURNS TABLE("media_id" "uuid", "object_path" "text", "lease_id" "uuid")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select *
  from private.claim_group_media_cleanup(p_limit, p_lease_seconds);
$$;

ALTER FUNCTION "public"."claim_group_media_cleanup"("p_limit" integer, "p_lease_seconds" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."complete_group_media_cleanup"("p_media_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.complete_group_media_cleanup(
    p_media_id,
    p_lease_id,
    p_object_deleted
  );
$$;

ALTER FUNCTION "public"."complete_group_media_cleanup"("p_media_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."create_group"("p_kind" "public"."group_kind", "p_name" "text", "p_description" "text" DEFAULT ''::"text", "p_slug" "text" DEFAULT NULL::"text", "p_join_policy" "public"."group_join_policy" DEFAULT NULL::"public"."group_join_policy", "p_identity_policy" "public"."group_identity_policy" DEFAULT 'optional_anonymous'::"public"."group_identity_policy", "p_posting_policy" "public"."group_posting_policy" DEFAULT 'members'::"public"."group_posting_policy") RETURNS TABLE("group_id" "uuid", "slug" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."create_group"("p_kind" "public"."group_kind", "p_name" "text", "p_description" "text", "p_slug" "text", "p_join_policy" "public"."group_join_policy", "p_identity_policy" "public"."group_identity_policy", "p_posting_policy" "public"."group_posting_policy") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";

CREATE OR REPLACE FUNCTION "public"."delete_group"("p_group_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  set status = 'deleted', deleted_at = now(),
    cleanup_lease_id = null, cleanup_lease_expires_at = null
  where group_id = p_group_id and status <> 'deleted';

  update public.post_attachments as attachment
  set status = 'deleted', deleted_at = now(),
    cleanup_lease_id = null, cleanup_lease_expires_at = null
  where attachment.status <> 'deleted'
    and exists (
      select 1 from public.posts as post
      where post.id = attachment.post_id and post.group_id = p_group_id
    );

  update public.posts
  set deleted_at = now(), pinned_at = null
  where group_id = p_group_id and deleted_at is null;

  delete from public.group_join_requests where group_id = p_group_id;
  delete from public.group_memberships where group_id = p_group_id;
end;
$$;

ALTER FUNCTION "public"."delete_group"("p_group_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."discover_groups"("p_query" "text" DEFAULT ''::"text", "p_include_joined" boolean DEFAULT false, "p_after_rank" smallint DEFAULT NULL::smallint, "p_after_member_count" bigint DEFAULT NULL::bigint, "p_after_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 13) RETURNS TABLE("group_id" "uuid", "slug" "text", "name" "text", "description" "text", "join_policy" "public"."group_join_policy", "identity_policy" "public"."group_identity_policy", "icon_path" "text", "cover_path" "text", "member_count" bigint, "membership_state" "text", "member_role" "public"."group_member_role", "requested_at" timestamp with time zone, "sort_rank" smallint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."discover_groups"("p_query" "text", "p_include_joined" boolean, "p_after_rank" smallint, "p_after_member_count" bigint, "p_after_id" "uuid", "p_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."finalize_group_media"("p_media_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."finalize_group_media"("p_media_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_group_invite"("p_group_id" "uuid") RETURNS TABLE("token" "text", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.assert_group_invite_manager(p_group_id);

  return query
  select invite.token, invite.expires_at
  from private.group_invites as invite
  where invite.group_id = p_group_id
    and invite.expires_at > now();
end;
$$;

ALTER FUNCTION "public"."get_group_invite"("p_group_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_group_invite_preview"("p_token" "text") RETURNS TABLE("group_id" "uuid", "slug" "text", "name" "text", "description" "text", "join_policy" "public"."group_join_policy", "identity_policy" "public"."group_identity_policy", "posting_policy" "public"."group_posting_policy", "member_count" bigint, "expires_at" timestamp with time zone, "already_member" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."get_group_invite_preview"("p_token" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."issue_group_invite"("p_group_id" "uuid", "p_hours" integer DEFAULT 24) RETURNS TABLE("token" "text", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."issue_group_invite"("p_group_id" "uuid", "p_hours" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_group_join_requests"("p_group_id" "uuid") RETURNS TABLE("request_id" "uuid", "pub_id" "text", "name" "text", "cohort" smallint, "avatar_path" "text", "requested_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    profile.avatar_path, join_request.requested_at
  from public.group_join_requests as join_request
  join public.profiles as profile on profile.id = join_request.profile_id
  where join_request.group_id = p_group_id
  order by join_request.requested_at, join_request.id;
end;
$$;

ALTER FUNCTION "public"."list_group_join_requests"("p_group_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."list_group_members"("p_group_id" "uuid", "p_query" "text" DEFAULT ''::"text", "p_after_role" "public"."group_member_role" DEFAULT NULL::"public"."group_member_role", "p_after_joined_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_after_membership_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 30) RETURNS TABLE("membership_id" "uuid", "pub_id" "text", "name" "text", "cohort" smallint, "avatar_path" "text", "role" "public"."group_member_role", "joined_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    profile.avatar_path, membership.role, membership.joined_at
  from public.group_memberships as membership
  join public.profiles as profile on profile.id = membership.profile_id
  where membership.group_id = p_group_id
    and (
      query_text = ''
      or profile.cohort::text like '%' || query_text || '%'
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
$$;

ALTER FUNCTION "public"."list_group_members"("p_group_id" "uuid", "p_query" "text", "p_after_role" "public"."group_member_role", "p_after_joined_at" timestamp with time zone, "p_after_membership_id" "uuid", "p_limit" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."prepare_group_media"("p_group_id" "uuid", "p_slot" "public"."group_media_slot", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) RETURNS TABLE("media_id" "uuid", "object_path" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."prepare_group_media"("p_group_id" "uuid", "p_slot" "public"."group_media_slot", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."reject_group_join_request"("p_group_id" "uuid", "p_request_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."reject_group_join_request"("p_group_id" "uuid", "p_request_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."remove_group_media"("p_group_id" "uuid", "p_slot" "public"."group_media_slot") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."remove_group_media"("p_group_id" "uuid", "p_slot" "public"."group_media_slot") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."revoke_group_invite"("p_group_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.assert_group_invite_manager(p_group_id);

  delete from private.group_invites as invite
  where invite.group_id = p_group_id;
end;
$$;

ALTER FUNCTION "public"."revoke_group_invite"("p_group_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."transfer_group_ownership"("p_group_id" "uuid", "p_target_membership_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."transfer_group_ownership"("p_group_id" "uuid", "p_target_membership_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."update_group_member_role"("p_group_id" "uuid", "p_membership_id" "uuid", "p_role" "public"."group_member_role") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."update_group_member_role"("p_group_id" "uuid", "p_membership_id" "uuid", "p_role" "public"."group_member_role") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."update_group_settings"("p_group_id" "uuid", "p_name" "text", "p_description" "text", "p_join_policy" "public"."group_join_policy", "p_identity_policy" "public"."group_identity_policy", "p_posting_policy" "public"."group_posting_policy") RETURNS TABLE("name" "text", "description" "text", "join_policy" "public"."group_join_policy", "identity_policy" "public"."group_identity_policy", "posting_policy" "public"."group_posting_policy", "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

ALTER FUNCTION "public"."update_group_settings"("p_group_id" "uuid", "p_name" "text", "p_description" "text", "p_join_policy" "public"."group_join_policy", "p_identity_policy" "public"."group_identity_policy", "p_posting_policy" "public"."group_posting_policy") OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "private"."group_invites" (
    "group_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "created_by" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "group_invites_expires_after_creation" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "group_invites_token_format" CHECK (("token" ~ '^[a-f0-9]{32}$'::"text"))
);

ALTER TABLE "private"."group_invites" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."group_join_requests" (
    "group_id" "uuid" NOT NULL,
    "profile_id" bigint NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);

ALTER TABLE "public"."group_join_requests" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."group_media_objects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "slot" "public"."group_media_slot" NOT NULL,
    "object_path" "text" NOT NULL,
    "size_bytes" bigint NOT NULL,
    "width" integer NOT NULL,
    "height" integer NOT NULL,
    "status" "public"."group_media_status" DEFAULT 'pending'::"public"."group_media_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ready_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "cleanup_lease_id" "uuid",
    "cleanup_lease_expires_at" timestamp with time zone,
    CONSTRAINT "group_media_cleanup_lease_check" CHECK ((("cleanup_lease_id" IS NULL) = ("cleanup_lease_expires_at" IS NULL))),
    CONSTRAINT "group_media_dimensions_check" CHECK (((("slot" = 'icon'::"public"."group_media_slot") AND ("width" = "height") AND (("width" >= 1) AND ("width" <= 512))) OR (("slot" = 'cover'::"public"."group_media_slot") AND ("width" = ("height" * 4)) AND (("width" >= 4) AND ("width" <= 2400))))),
    CONSTRAINT "group_media_path_check" CHECK (("object_path" = ((((("group_id")::"text" || '/'::"text") || ("slot")::"text") || '/'::"text") || ("id")::"text"))),
    CONSTRAINT "group_media_size_check" CHECK ((("size_bytes" >= 1) AND ("size_bytes" <=
CASE "slot"
    WHEN 'icon'::"public"."group_media_slot" THEN 1048576
    ELSE 4194304
END))),
    CONSTRAINT "group_media_status_timestamps_check" CHECK (((("status" = 'pending'::"public"."group_media_status") AND ("ready_at" IS NULL) AND ("deleted_at" IS NULL)) OR (("status" = 'ready'::"public"."group_media_status") AND ("ready_at" IS NOT NULL) AND ("deleted_at" IS NULL)) OR (("status" = 'deleted'::"public"."group_media_status") AND ("deleted_at" IS NOT NULL))))
);

ALTER TABLE "public"."group_media_objects" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."group_memberships" (
    "group_id" "uuid" NOT NULL,
    "profile_id" bigint NOT NULL,
    "role" "public"."group_member_role" DEFAULT 'member'::"public"."group_member_role" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pinned_at" timestamp with time zone,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);

ALTER TABLE "public"."group_memberships" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "slug_is_custom" boolean DEFAULT false NOT NULL,
    "kind" "public"."group_kind" NOT NULL,
    "name" "text" NOT NULL,
    "search_name" "text" GENERATED ALWAYS AS ("lower"("regexp_replace"("btrim"("name"), '[[:space:]]+'::"text", ''::"text", 'g'::"text"))) STORED,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "join_policy" "public"."group_join_policy" NOT NULL,
    "identity_policy" "public"."group_identity_policy" NOT NULL,
    "posting_policy" "public"."group_posting_policy" NOT NULL,
    "created_by" bigint NOT NULL,
    "icon_path" "text",
    "cover_path" "text",
    "member_count" bigint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "groups_description_length" CHECK (("char_length"("description") <= 2000)),
    CONSTRAINT "groups_member_count_nonnegative" CHECK (("member_count" >= 0)),
    CONSTRAINT "groups_name_length" CHECK ((("char_length"("btrim"("name")) >= 1) AND ("char_length"("btrim"("name")) <= 50))),
    CONSTRAINT "groups_slug_format" CHECK (char_length("slug") BETWEEN 4 AND 15 AND "slug" ~ '^[a-z0-9][a-z0-9-]{2,13}[a-z0-9]$'),
    CONSTRAINT "groups_slug_reserved" CHECK (("slug" <> ALL (ARRAY['create'::"text", 'discover'::"text"])))
);

ALTER TABLE "public"."groups" OWNER TO "postgres";

ALTER TABLE ONLY "private"."group_invites"
    ADD CONSTRAINT "group_invites_pkey" PRIMARY KEY ("group_id");

ALTER TABLE ONLY "private"."group_invites"
    ADD CONSTRAINT "group_invites_token_key" UNIQUE ("token");

ALTER TABLE ONLY "public"."group_join_requests"
    ADD CONSTRAINT "group_join_requests_id_key" UNIQUE ("id");

ALTER TABLE ONLY "public"."group_join_requests"
    ADD CONSTRAINT "group_join_requests_pkey" PRIMARY KEY ("group_id", "profile_id");

ALTER TABLE ONLY "public"."group_media_objects"
    ADD CONSTRAINT "group_media_objects_object_path_key" UNIQUE ("object_path");

ALTER TABLE ONLY "public"."group_media_objects"
    ADD CONSTRAINT "group_media_objects_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."group_memberships"
    ADD CONSTRAINT "group_memberships_id_key" UNIQUE ("id");

ALTER TABLE ONLY "public"."group_memberships"
    ADD CONSTRAINT "group_memberships_pkey" PRIMARY KEY ("group_id", "profile_id");

ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_slug_key" UNIQUE ("slug");

CREATE INDEX "group_join_requests_moderation_idx" ON "public"."group_join_requests" USING "btree" ("group_id", "requested_at", "id");

CREATE INDEX "group_join_requests_profile_idx" ON "public"."group_join_requests" USING "btree" ("profile_id", "requested_at" DESC);

CREATE INDEX "group_media_cleanup_idx" ON "public"."group_media_objects" USING "btree" ("created_at", "id") WHERE ("status" = ANY (ARRAY['pending'::"public"."group_media_status", 'deleted'::"public"."group_media_status"]));

CREATE UNIQUE INDEX "group_memberships_one_owner_idx" ON "public"."group_memberships" USING "btree" ("group_id") WHERE ("role" = 'owner'::"public"."group_member_role");

CREATE INDEX "group_memberships_profile_order_idx" ON "public"."group_memberships" USING "btree" ("profile_id", "pinned_at" DESC, "joined_at" DESC);

CREATE INDEX "group_memberships_roster_idx" ON "public"."group_memberships" USING "btree" ("group_id", "role", "joined_at", "id");

CREATE INDEX "groups_created_by_idx" ON "public"."groups" USING "btree" ("created_by");

CREATE INDEX "groups_discovery_idx" ON "public"."groups" USING "btree" ("kind", "join_policy", "member_count" DESC, "id");

CREATE UNIQUE INDEX "groups_official_name_unique_idx" ON "public"."groups" USING "btree" ("lower"("btrim"("name"))) WHERE ("kind" = 'official'::"public"."group_kind");

CREATE INDEX "groups_search_name_trgm_idx" ON "public"."groups" USING "gin" ("search_name" "extensions"."gin_trgm_ops") WHERE (("kind" = 'unofficial'::"public"."group_kind") AND ("join_policy" <> 'invite_only'::"public"."group_join_policy"));

CREATE OR REPLACE TRIGGER "group_join_requests_lock_group" BEFORE INSERT ON "public"."group_join_requests" FOR EACH ROW EXECUTE FUNCTION "private"."lock_group_for_join_request"();

CREATE OR REPLACE TRIGGER "group_memberships_sync_count" AFTER INSERT OR DELETE ON "public"."group_memberships" FOR EACH ROW EXECUTE FUNCTION "private"."sync_group_member_count"();

CREATE OR REPLACE TRIGGER "groups_initialize_memberships" AFTER INSERT ON "public"."groups" FOR EACH ROW EXECUTE FUNCTION "private"."initialize_group_memberships"();

CREATE OR REPLACE TRIGGER "groups_prevent_identity_changes" BEFORE UPDATE ON "public"."groups" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_group_identity_changes"();

CREATE OR REPLACE TRIGGER "groups_set_updated_at" BEFORE UPDATE ON "public"."groups" FOR EACH ROW EXECUTE FUNCTION "private"."set_updated_at"();

CREATE OR REPLACE TRIGGER "profiles_sync_official_memberships" AFTER INSERT OR UPDATE OF "status", "type", "deleted_at" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "private"."sync_student_official_memberships"();

ALTER TABLE ONLY "private"."group_invites"
    ADD CONSTRAINT "group_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "private"."group_invites"
    ADD CONSTRAINT "group_invites_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."group_join_requests"
    ADD CONSTRAINT "group_join_requests_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."group_join_requests"
    ADD CONSTRAINT "group_join_requests_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."group_media_objects"
    ADD CONSTRAINT "group_media_objects_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."group_memberships"
    ADD CONSTRAINT "group_memberships_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."group_memberships"
    ADD CONSTRAINT "group_memberships_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");

ALTER TABLE "private"."group_invites" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_invites_deny_client_access" ON "private"."group_invites" USING (false) WITH CHECK (false);

ALTER TABLE "public"."group_join_requests" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_join_requests_create_own" ON "public"."group_join_requests" FOR INSERT TO "authenticated" WITH CHECK ((("profile_id" = "private"."current_profile_id"()) AND (EXISTS ( SELECT 1
   FROM ("public"."profiles" "profile"
     JOIN "public"."groups" "group_record" ON (("group_record"."id" = "group_join_requests"."group_id")))
  WHERE (("profile"."id" = "group_join_requests"."profile_id") AND ("profile"."type" = ANY (ARRAY['student'::"public"."profile_type", 'alumni'::"public"."profile_type"])) AND ("group_record"."join_policy" = 'request'::"public"."group_join_policy")))) AND (NOT "private"."is_group_member"("group_id"))));

CREATE POLICY "group_join_requests_delete_own" ON "public"."group_join_requests" FOR DELETE TO "authenticated" USING (("profile_id" = "private"."current_profile_id"()));

CREATE POLICY "group_join_requests_select_own" ON "public"."group_join_requests" FOR SELECT TO "authenticated" USING (("profile_id" = "private"."current_profile_id"()));

ALTER TABLE "public"."group_media_objects" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_media_objects_no_direct_browser_read" ON "public"."group_media_objects" FOR SELECT TO "authenticated" USING (false);

ALTER TABLE "public"."group_memberships" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_memberships_join_open" ON "public"."group_memberships" FOR INSERT TO "authenticated" WITH CHECK ((("profile_id" = "private"."current_profile_id"()) AND ("role" = 'member'::"public"."group_member_role") AND (EXISTS ( SELECT 1
   FROM ("public"."profiles" "profile"
     JOIN "public"."groups" "group_record" ON (("group_record"."id" = "group_memberships"."group_id")))
  WHERE (("profile"."id" = "group_memberships"."profile_id") AND ("profile"."type" = ANY (ARRAY['student'::"public"."profile_type", 'alumni'::"public"."profile_type"])) AND ("group_record"."join_policy" = 'open'::"public"."group_join_policy"))))));

CREATE POLICY "group_memberships_leave_own" ON "public"."group_memberships" FOR DELETE TO "authenticated" USING ((("profile_id" = "private"."current_profile_id"()) AND ("role" <> 'owner'::"public"."group_member_role") AND (EXISTS ( SELECT 1
   FROM "public"."groups" "group_record"
  WHERE (("group_record"."id" = "group_memberships"."group_id") AND ("group_record"."kind" = 'unofficial'::"public"."group_kind"))))));

CREATE POLICY "group_memberships_select_own" ON "public"."group_memberships" FOR SELECT TO "authenticated" USING (("profile_id" = "private"."current_profile_id"()));

CREATE POLICY "group_memberships_update_own" ON "public"."group_memberships" FOR UPDATE TO "authenticated" USING (("profile_id" = "private"."current_profile_id"())) WITH CHECK (("profile_id" = "private"."current_profile_id"()));

ALTER TABLE "public"."groups" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "groups_select_visible" ON "public"."groups" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
    FROM "public"."profiles" "profile"
   WHERE (("profile"."id" = "private"."current_profile_id"()) AND ((("profile"."role" = 'admin'::"public"."app_role") AND ("groups"."kind" = 'official'::"public"."group_kind")) OR (("profile"."type" = ANY (ARRAY['student'::"public"."profile_type", 'alumni'::"public"."profile_type"])) AND (("groups"."kind" = 'official'::"public"."group_kind") OR (("groups"."kind" = 'unofficial'::"public"."group_kind") AND ("groups"."join_policy" <> 'invite_only'::"public"."group_join_policy")))) OR (("groups"."kind" = 'unofficial'::"public"."group_kind") AND "private"."is_group_member"("groups"."id"))))))));

REVOKE ALL ON FUNCTION "private"."assert_group_invite_manager"("p_group_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."can_manage_group"("p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_manage_group"("p_group_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."can_read_group_media"("p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_read_group_media"("p_object_path" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."can_upload_group_media"("p_object_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_upload_group_media"("p_object_path" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."claim_group_media_cleanup"("p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."claim_group_media_cleanup"("p_limit" integer, "p_lease_seconds" integer) TO "service_role";

REVOKE ALL ON FUNCTION "private"."complete_group_media_cleanup"("p_media_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."complete_group_media_cleanup"("p_media_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) TO "service_role";

REVOKE ALL ON FUNCTION "private"."initialize_group_memberships"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."is_group_member"("p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_group_member"("p_group_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "private"."lock_group_for_join_request"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."prevent_group_identity_changes"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."recount_group_members"("p_group_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."sync_group_member_count"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."sync_student_official_memberships"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."accept_group_invite"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_group_invite"("p_token" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."approve_group_join_request"("p_group_id" "uuid", "p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_group_join_request"("p_group_id" "uuid", "p_request_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."claim_group_media_cleanup"("p_limit" integer, "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_group_media_cleanup"("p_limit" integer, "p_lease_seconds" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."complete_group_media_cleanup"("p_media_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_group_media_cleanup"("p_media_id" "uuid", "p_lease_id" "uuid", "p_object_deleted" boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."create_group"("p_kind" "public"."group_kind", "p_name" "text", "p_description" "text", "p_slug" "text", "p_join_policy" "public"."group_join_policy", "p_identity_policy" "public"."group_identity_policy", "p_posting_policy" "public"."group_posting_policy") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_group"("p_kind" "public"."group_kind", "p_name" "text", "p_description" "text", "p_slug" "text", "p_join_policy" "public"."group_join_policy", "p_identity_policy" "public"."group_identity_policy", "p_posting_policy" "public"."group_posting_policy") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."delete_group"("p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_group"("p_group_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."discover_groups"("p_query" "text", "p_include_joined" boolean, "p_after_rank" smallint, "p_after_member_count" bigint, "p_after_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."discover_groups"("p_query" "text", "p_include_joined" boolean, "p_after_rank" smallint, "p_after_member_count" bigint, "p_after_id" "uuid", "p_limit" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."finalize_group_media"("p_media_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_group_media"("p_media_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_group_invite"("p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_group_invite"("p_group_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_group_invite_preview"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_group_invite_preview"("p_token" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."issue_group_invite"("p_group_id" "uuid", "p_hours" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."issue_group_invite"("p_group_id" "uuid", "p_hours" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_group_join_requests"("p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_group_join_requests"("p_group_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_group_members"("p_group_id" "uuid", "p_query" "text", "p_after_role" "public"."group_member_role", "p_after_joined_at" timestamp with time zone, "p_after_membership_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_group_members"("p_group_id" "uuid", "p_query" "text", "p_after_role" "public"."group_member_role", "p_after_joined_at" timestamp with time zone, "p_after_membership_id" "uuid", "p_limit" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_group_media"("p_group_id" "uuid", "p_slot" "public"."group_media_slot", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_group_media"("p_group_id" "uuid", "p_slot" "public"."group_media_slot", "p_size_bytes" bigint, "p_width" integer, "p_height" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."reject_group_join_request"("p_group_id" "uuid", "p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_group_join_request"("p_group_id" "uuid", "p_request_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."remove_group_media"("p_group_id" "uuid", "p_slot" "public"."group_media_slot") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_group_media"("p_group_id" "uuid", "p_slot" "public"."group_media_slot") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."revoke_group_invite"("p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_group_invite"("p_group_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."transfer_group_ownership"("p_group_id" "uuid", "p_target_membership_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transfer_group_ownership"("p_group_id" "uuid", "p_target_membership_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_group_member_role"("p_group_id" "uuid", "p_membership_id" "uuid", "p_role" "public"."group_member_role") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_group_member_role"("p_group_id" "uuid", "p_membership_id" "uuid", "p_role" "public"."group_member_role") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_group_settings"("p_group_id" "uuid", "p_name" "text", "p_description" "text", "p_join_policy" "public"."group_join_policy", "p_identity_policy" "public"."group_identity_policy", "p_posting_policy" "public"."group_posting_policy") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_group_settings"("p_group_id" "uuid", "p_name" "text", "p_description" "text", "p_join_policy" "public"."group_join_policy", "p_identity_policy" "public"."group_identity_policy", "p_posting_policy" "public"."group_posting_policy") TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."group_join_requests" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."group_join_requests" TO "authenticated";

GRANT INSERT("group_id") ON TABLE "public"."group_join_requests" TO "authenticated";

GRANT INSERT("profile_id") ON TABLE "public"."group_join_requests" TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."group_media_objects" TO "service_role";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."group_memberships" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."group_memberships" TO "authenticated";

GRANT INSERT("group_id") ON TABLE "public"."group_memberships" TO "authenticated";

GRANT INSERT("profile_id") ON TABLE "public"."group_memberships" TO "authenticated";

GRANT UPDATE("pinned_at") ON TABLE "public"."group_memberships" TO "authenticated";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."groups" TO "service_role";
GRANT SELECT ON TABLE "public"."groups" TO "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."groups" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."group_memberships" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."group_join_requests" FROM "anon", "authenticated";

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."group_media_objects" FROM "anon", "authenticated";
