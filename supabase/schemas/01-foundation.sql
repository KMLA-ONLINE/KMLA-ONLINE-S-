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

GRANT USAGE ON SCHEMA "private" TO "authenticated";
GRANT USAGE ON SCHEMA "private" TO "service_role";

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

-- 열려 있는 옛 앱이 이 DB와 함께 쓰일 수 있는 최소 클라이언트 버전. 이보다 낮은 앱은 업데이트 전까지
-- 화면이 막힌다. 로그인 전 화면도 확인하므로 anon에게 연다.
-- 손으로 고치지 않는다. `npm run client-compat:bump`가 앱의 `CLIENT_COMPAT_VERSION`과 함께 올린다.
CREATE OR REPLACE FUNCTION "public"."min_client_version"() RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select 1;
$$;

ALTER FUNCTION "public"."min_client_version"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."min_client_version"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."min_client_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."min_client_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."min_client_version"() TO "service_role";
