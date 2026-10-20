SET local check_function_bodies = off;

CREATE TABLE "private"."application_rejections" (
  "id"                     bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "profile_id"             bigint                   NOT NULL,
  "reason"                 text                     NOT NULL,
  "rejected_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "rejected_by_profile_id" bigint,
  CONSTRAINT "application_rejections_pkey" PRIMARY KEY (id),
  CONSTRAINT "application_rejections_reason" CHECK (((reason = btrim(reason)) AND (char_length(reason) >= 5) AND (char_length(reason) <= 300)))
);

ALTER TABLE "private"."application_rejections"
  ENABLE ROW LEVEL SECURITY;

ALTER TYPE "public"."notification_kind" ADD VALUE 'account_rejected' BEFORE 'account_blocked';

