SET local check_function_bodies = off;

ALTER TABLE "private"."school_notices"
  ADD COLUMN "body" text NOT NULL DEFAULT ''::text;

ALTER TABLE "private"."school_notices"
  ADD COLUMN "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.get_school_notice (
  p_post_id integer
)
  RETURNS TABLE (
    post_id     integer,
    category    text,
    title       text,
    author      text,
    posted_on   date,
    body        text,
    attachments jsonb
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select
    notice.post_id,
    notice.category,
    notice.title,
    notice.author,
    notice.posted_on,
    notice.body,
    notice.attachments
  from private.school_notices as notice
  where notice.post_id = p_post_id
    and private.current_profile_id() is not null;
$function$;

REVOKE ALL ON FUNCTION "public"."get_school_notice"(integer) FROM PUBLIC, "anon", "service_role";

CREATE OR REPLACE FUNCTION public.record_school_notice_sync (
  p_notices jsonb,
  p_error   text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if p_error is not null then
    insert into private.school_notice_sync_state (id, last_attempt_at, last_error, last_error_at)
    values (true, now(), left(p_error, 200), now())
    on conflict (id) do update
    set last_attempt_at = excluded.last_attempt_at,
      last_error = excluded.last_error,
      last_error_at = excluded.last_error_at;
    return;
  end if;

  if jsonb_typeof(p_notices) is distinct from 'array'
    or jsonb_array_length(p_notices) not between 1 and 50 then
    raise exception 'notices must be a non-empty array of at most 50 items'
      using errcode = '22023';
  end if;

  delete from private.school_notices where true;

  insert into private.school_notices (
    post_id, list_position, category, title, author, posted_on, has_attachment, body, attachments
  )
  select
    (item.value ->> 'postId')::integer,
    (item.ordinality - 1)::smallint,
    item.value ->> 'category',
    item.value ->> 'title',
    item.value ->> 'author',
    (item.value ->> 'postedOn')::date,
    coalesce((item.value ->> 'hasAttachment')::boolean, false),
    left(coalesce(item.value ->> 'body', ''), 50000),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'attachment_id', (file.value ->> 'attachmentId')::integer,
          'name', file.value ->> 'name',
          'size', coalesce((file.value ->> 'size')::bigint, 0)
        )
        order by file.ordinality
      )
      from jsonb_array_elements(
        case when jsonb_typeof(item.value -> 'attachments') = 'array'
          then item.value -> 'attachments' else '[]'::jsonb end
      ) with ordinality as file(value, ordinality)
    ), '[]'::jsonb)
  from jsonb_array_elements(p_notices) with ordinality as item(value, ordinality);

  insert into private.school_notice_sync_state (id, last_attempt_at, last_success_at)
  values (true, now(), now())
  on conflict (id) do update
  set last_attempt_at = excluded.last_attempt_at,
    last_success_at = excluded.last_success_at;
end;
$function$;

ALTER TABLE "private"."school_notices"
  ADD CONSTRAINT "school_notices_attachments_check" CHECK ((jsonb_typeof(attachments) = 'array'::text));

GRANT EXECUTE ON FUNCTION "public"."get_school_notice"(integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_school_notice"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_school_notice"(integer) TO "postgres";
