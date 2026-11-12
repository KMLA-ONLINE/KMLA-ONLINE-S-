-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE EXTENSION IF NOT EXISTS "pg_cron";

CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";

CREATE SCHEMA IF NOT EXISTS "private";

ALTER SCHEMA "private" OWNER TO "postgres";

CREATE SCHEMA IF NOT EXISTS "public";

ALTER SCHEMA "public" OWNER TO "pg_database_owner";

COMMENT ON SCHEMA "public" IS 'standard public schema';

CREATE OR REPLACE FUNCTION "private"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

ALTER FUNCTION "private"."set_updated_at"() OWNER TO "postgres";

-- 게시물과 메시지의 보관 GIF(기능 명세 §18.7)가 올라왔는지 확인한다. 둘의 확정 RPC가 같은 규칙을 쓴다.
-- Storage metadata는 업로드 요청이 정하므로 내용이 GIF인지는 서버가 알 수 없다. 형식과 상한만 강제한다.
CREATE OR REPLACE FUNCTION "private"."assert_uploaded_gif"("p_bucket" "text", "p_object_path" "text") RETURNS "void"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  uploaded storage.objects;
begin
  select object.* into uploaded
  from storage.objects as object
  where object.bucket_id = p_bucket
    and object.name = p_object_path;
  if uploaded.id is null then
    raise exception 'uploaded GIF not found' using errcode = 'P0002';
  end if;
  if uploaded.owner_id is distinct from auth.uid()::text then
    raise exception 'uploaded GIF owner does not match' using errcode = '42501';
  end if;
  if uploaded.metadata ->> 'mimetype' is distinct from 'image/gif'
    or (
      case
        when uploaded.metadata ->> 'size' ~ '^[0-9]+$'
        then (uploaded.metadata ->> 'size')::bigint not between 1 and 31457280
        else true
      end
    ) then
    raise exception 'uploaded GIF does not match' using errcode = '22023';
  end if;
end;
$$;

ALTER FUNCTION "private"."assert_uploaded_gif"("p_bucket" "text", "p_object_path" "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "private"."assert_uploaded_gif"("p_bucket" "text", "p_object_path" "text") FROM PUBLIC;

GRANT USAGE ON SCHEMA "private" TO "authenticated";
GRANT USAGE ON SCHEMA "private" TO "service_role";

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
