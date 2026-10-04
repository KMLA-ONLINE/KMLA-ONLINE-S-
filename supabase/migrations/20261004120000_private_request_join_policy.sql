-- 공개 그룹은 항상 즉시 가입이고, 승인 가입은 비공개 그룹에만 둔다(§7.5).
-- `request` 값은 그대로 두고 의미를 '비공개 및 승인 가입'으로 바꾼다. 공개 판정은 이제 `join_policy = 'open'`이다.

-- 기존 '공개 및 승인 가입' 그룹은 공개를 유지해야 하므로 즉시 가입으로 바꾼다. 남은 요청은 승인 없이 정리한다.
-- 공식 그룹은 언제나 즉시 가입이다. 마이그레이션에는 행위자가 없어 그룹 정책 변경 알림은 나가지 않는다.
delete from public.group_join_requests as join_request
using public.groups as group_record
where group_record.id = join_request.group_id
  and (group_record.join_policy = 'request' or group_record.kind = 'official');

update public.groups
set join_policy = 'open'
where join_policy = 'request'
  or (kind = 'official' and join_policy <> 'open');
CREATE OR REPLACE FUNCTION "private"."can_request_group_join"("p_group_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  -- 승인 가입 그룹은 비공개라 요청자의 RLS로는 그룹 행이 보이지 않는다. 그래서 정책 대신 여기서 확인한다.
  select exists (
    select 1
    from public.groups as group_record
    join public.profiles as profile
      on profile.id = private.current_profile_id()
    where group_record.id = p_group_id
      and group_record.kind = 'unofficial'
      and group_record.join_policy = 'request'
      and profile.type in ('student', 'alumni')
  )
  and not private.is_group_member(p_group_id);
$$;
ALTER FUNCTION "private"."can_request_group_join"("p_group_id" "uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "private"."can_request_group_join"("p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_request_group_join"("p_group_id" "uuid") TO "authenticated";

DROP POLICY "group_join_requests_create_own" ON "public"."group_join_requests";
CREATE POLICY "group_join_requests_create_own" ON "public"."group_join_requests" FOR INSERT TO "authenticated" WITH CHECK ((("profile_id" = "private"."current_profile_id"()) AND "private"."can_request_group_join"("group_id")));

DROP POLICY "groups_select_visible" ON "public"."groups";
CREATE POLICY "groups_select_visible" ON "public"."groups" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
    FROM "public"."profiles" "profile"
   WHERE (("profile"."id" = "private"."current_profile_id"()) AND ((("profile"."role" = 'admin'::"public"."app_role") AND ("groups"."kind" = 'official'::"public"."group_kind")) OR (("profile"."type" = ANY (ARRAY['student'::"public"."profile_type", 'alumni'::"public"."profile_type"])) AND (("groups"."kind" = 'official'::"public"."group_kind") OR (("groups"."kind" = 'unofficial'::"public"."group_kind") AND ("groups"."join_policy" = 'open'::"public"."group_join_policy")))) OR (("groups"."kind" = 'unofficial'::"public"."group_kind") AND "private"."is_group_member"("groups"."id"))))))));

DROP INDEX "public"."groups_search_name_trgm_idx";
CREATE INDEX "groups_search_name_trgm_idx" ON "public"."groups" USING "gin" ("search_name" "extensions"."gin_trgm_ops") WHERE (("kind" = 'unofficial'::"public"."group_kind") AND ("join_policy" = 'open'::"public"."group_join_policy"));

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
                and group_record.join_policy = 'open'
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

CREATE OR REPLACE FUNCTION "public"."create_group"("p_kind" "public"."group_kind", "p_name" "text", "p_description" "text" DEFAULT ''::"text", "p_slug" "text" DEFAULT NULL::"text", "p_join_policy" "public"."group_join_policy" DEFAULT NULL::"public"."group_join_policy", "p_identity_policy" "public"."group_identity_policy" DEFAULT 'optional_anonymous'::"public"."group_identity_policy", "p_posting_policy" "public"."group_posting_policy" DEFAULT 'members'::"public"."group_posting_policy", "p_hide_staff_roles" boolean DEFAULT false) RETURNS TABLE("group_id" "uuid", "slug" "text")
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

  -- 공개 그룹은 즉시 가입뿐이고, 승인 가입은 비공개 그룹에만 있다(§7.5).
  if p_kind = 'official' and chosen_policy <> 'open' then
    raise exception 'official groups must be open' using errcode = '22023';
  end if;

  if chosen_policy <> 'open' and nullif(btrim(p_slug), '') is not null then
    raise exception 'private groups cannot use a custom slug' using errcode = '22023';
  end if;

  if chosen_policy <> 'open' or nullif(btrim(p_slug), '') is null then
    chosen_slug := encode(extensions.gen_random_bytes(7), 'hex');
  else
    chosen_slug := lower(btrim(p_slug));
  end if;

  insert into public.groups (
    id, slug, slug_is_custom, kind, name, description, join_policy,
    identity_policy, posting_policy, hide_staff_roles, created_by
  ) values (
    created_group_id,
    chosen_slug,
    chosen_policy = 'open' and nullif(btrim(p_slug), '') is not null,
    p_kind,
    btrim(p_name),
    btrim(coalesce(p_description, '')),
    chosen_policy,
    p_identity_policy,
    p_posting_policy,
    p_hide_staff_roles,
    caller_profile.id
  );

  return query select created_group_id, chosen_slug;
end;
$$;

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
      and group_record.join_policy = 'open'
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

CREATE OR REPLACE FUNCTION "public"."update_group_settings"("p_group_id" "uuid", "p_name" "text", "p_description" "text", "p_join_policy" "public"."group_join_policy", "p_identity_policy" "public"."group_identity_policy", "p_posting_policy" "public"."group_posting_policy", "p_hide_staff_roles" boolean) RETURNS TABLE("name" "text", "description" "text", "join_policy" "public"."group_join_policy", "identity_policy" "public"."group_identity_policy", "posting_policy" "public"."group_posting_policy", "hide_staff_roles" boolean, "updated_at" timestamp with time zone)
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
  if current_group.join_policy = 'open' and p_join_policy <> 'open' then
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
    posting_policy = p_posting_policy, hide_staff_roles = p_hide_staff_roles
  where group_record.id = p_group_id
  returning group_record.name, group_record.description, group_record.join_policy,
    group_record.identity_policy, group_record.posting_policy,
    group_record.hide_staff_roles, group_record.updated_at;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_group_link_preview"("p_slug" "text") RETURNS TABLE("group_id" "uuid", "slug" "text", "name" "text", "description" "text", "join_policy" "public"."group_join_policy", "identity_policy" "public"."group_identity_policy", "posting_policy" "public"."group_posting_policy", "member_count" bigint, "requested_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile_id bigint := private.current_profile_id();
begin
  if caller_profile_id is null then
    raise exception 'accepted profile required' using errcode = '42501';
  end if;

  -- 비공개 승인 가입 그룹은 RLS로 보이지 않는다. 주소를 정확히 아는 비멤버에게만 초대 미리보기와
  -- 같은 정보를 준다(§7.5). 이미지와 명부는 주지 않는다.
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
    join_request.requested_at
  from public.groups as group_record
  left join public.group_join_requests as join_request
    on join_request.group_id = group_record.id
    and join_request.profile_id = caller_profile_id
  where group_record.slug = p_slug
    and group_record.kind = 'unofficial'
    and group_record.join_policy = 'request'
    and not private.is_group_member(group_record.id);
end;
$$;
ALTER FUNCTION "public"."get_group_link_preview"("p_slug" "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_group_link_preview"("p_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_group_link_preview"("p_slug" "text") TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."search_directory"("p_query" "text" DEFAULT ''::"text") RETURNS TABLE("result_kind" "text", "result_id" "text", "result_name" "text", "avatar_path" "text", "sort_rank" smallint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile public.profiles;
  normalized_query text := lower(
    regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g')
  );
begin
  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if caller_profile.id is null then
    raise exception 'search requires an accepted profile' using errcode = '42501';
  end if;

  if char_length(normalized_query) < 2 then
    return;
  end if;

  return query
  (
    select
      'profile'::text,
      person.pub_id,
      person.name,
      person.avatar_path,
      case
        when person.search_name = normalized_query then 0
        when person.search_name like normalized_query || '%' then 1
        else 2
      end::smallint
    from public.profiles as person
    where person.status = 'accepted'
      and person.deleted_at is null
      and person.search_name like '%' || normalized_query || '%'
    order by 5, person.name
    limit 5
  )
  union all
  (
    select
      'group'::text,
      group_record.slug,
      group_record.name,
      group_record.icon_path,
      case
        when group_record.search_name = normalized_query then 0
        when group_record.search_name like normalized_query || '%' then 1
        else 2
      end::smallint
    from public.groups as group_record
    where caller_profile.type <> 'teacher'
      and (group_record.kind = 'official' or group_record.join_policy = 'open')
      and group_record.search_name like '%' || normalized_query || '%'
    order by 5, group_record.name
    limit 5
  );
end;
$$;
