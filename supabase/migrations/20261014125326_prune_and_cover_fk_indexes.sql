DROP INDEX "public"."comment_images_post_idx";

DROP INDEX "public"."post_attachments_post_list_idx";

DROP INDEX "public"."post_comments_live_child_idx";

DROP INDEX "public"."profiles_accepted_students_idx";

CREATE INDEX group_anonymous_restrictions_source_comment_idx ON private.group_anonymous_activity_restrictions USING btree (source_comment_id)
  WHERE (source_comment_id IS NOT NULL);

CREATE INDEX group_anonymous_restrictions_source_post_idx ON private.group_anonymous_activity_restrictions USING btree (source_post_id)
  WHERE (source_post_id IS NOT NULL);

CREATE INDEX comment_images_comment_idx ON public.comment_images USING btree (comment_id);

CREATE INDEX comment_images_post_idx ON public.comment_images USING btree (post_id, comment_id);

CREATE INDEX notifications_comment_idx ON public.notifications USING btree (comment_id)
  WHERE (comment_id IS NOT NULL);

CREATE INDEX notifications_post_idx ON public.notifications USING btree (post_id)
  WHERE (post_id IS NOT NULL);

CREATE INDEX post_attachments_post_list_idx ON public.post_attachments USING btree (post_id, "position", id);

CREATE INDEX post_comments_parent_idx ON public.post_comments USING btree (parent_comment_id);

CREATE INDEX post_comments_post_idx ON public.post_comments USING btree (post_id);
