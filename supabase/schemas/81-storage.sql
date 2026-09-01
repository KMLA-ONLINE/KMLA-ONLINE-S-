-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.

-- 어떤 버킷에도 클라이언트 DELETE를 허용하지 않는다. object의 수명은 전적으로 서버가 쥐고,
-- 정리는 `private.storage_cleanup_queue`를 드레인하는 Edge Function만 수행한다.


CREATE POLICY "comment_images_storage_insert_uploader" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'post-attachments'::"text") AND ("owner_id" = ( SELECT ("auth"."uid"())::"text" AS "uid")) AND "private"."can_upload_comment_image_object"("bucket_id", "name")));

CREATE POLICY "comment_images_storage_select_reader" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'post-attachments'::"text") AND "storage"."allow_any_operation"(ARRAY['object.get_authenticated_info'::"text", 'object.get_authenticated'::"text", 'object.sign'::"text", 'object.sign_many'::"text"]) AND "private"."can_read_comment_image_object"("bucket_id", "name")));

CREATE POLICY "group_media_storage_insert_pending_manager" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'group-media'::"text") AND ("owner_id" = ( SELECT ("auth"."uid"())::"text" AS "uid")) AND "private"."can_upload_group_media"("name")));

CREATE POLICY "group_media_storage_select_visible" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'group-media'::"text") AND "storage"."allow_any_operation"(ARRAY['object.get_authenticated_info'::"text", 'object.get_authenticated'::"text", 'object.sign'::"text", 'object.sign_many'::"text"]) AND "private"."can_read_group_media"("name")));

CREATE POLICY "post_attachments_storage_insert_pending_author" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'post-attachments'::"text") AND ("owner_id" = ( SELECT ("auth"."uid"())::"text" AS "uid")) AND (EXISTS ( SELECT 1
   FROM ("public"."post_attachments" "attachment"
     JOIN "public"."posts" "post" ON (("post"."id" = "attachment"."post_id")))
  WHERE (("attachment"."storage_bucket" = "objects"."bucket_id") AND ("attachment"."object_path" = "objects"."name") AND ("attachment"."status" = 'pending'::"public"."post_attachment_status") AND ("post"."deleted_at" IS NULL) AND "private"."is_post_author"("post"."id"))))));

CREATE POLICY "post_attachments_storage_select_reader" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'post-attachments'::"text") AND "storage"."allow_any_operation"(ARRAY['object.get_authenticated_info'::"text", 'object.get_authenticated'::"text", 'object.sign'::"text", 'object.sign_many'::"text"]) AND (EXISTS ( SELECT 1
   FROM "public"."post_attachments" "attachment"
  WHERE (("attachment"."storage_bucket" = "objects"."bucket_id") AND ("attachment"."object_path" = "objects"."name") AND ("attachment"."status" = 'ready'::"public"."post_attachment_status") AND "private"."can_read_post"("attachment"."post_id"))))));

CREATE POLICY "profile_media_insert_pending_owner" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'profile-media'::"text") AND ("owner_id" = ( SELECT ("auth"."uid"())::"text" AS "uid")) AND "private"."can_upload_profile_media"("name")));

CREATE POLICY "profile_media_select_accepted" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'profile-media'::"text") AND "storage"."allow_any_operation"(ARRAY['object.get_authenticated_info'::"text", 'object.get_authenticated'::"text", 'object.sign'::"text", 'object.sign_many'::"text"]) AND "private"."can_read_profile_media_path"("name")));
