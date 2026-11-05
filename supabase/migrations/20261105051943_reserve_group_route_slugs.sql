ALTER TABLE "public"."groups"
  DROP CONSTRAINT "groups_slug_reserved";

ALTER TABLE "public"."groups"
  ADD CONSTRAINT "groups_slug_reserved" CHECK ((slug <> ALL (ARRAY['create'::text, 'discover'::text, 'edit'::text, 'group'::text, 'new'::text, 'member-page'::text, 'report-page'::text])));
