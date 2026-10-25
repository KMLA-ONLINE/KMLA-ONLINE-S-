DROP POLICY "message_attachments_storage_select_member" ON "storage"."objects";

CREATE POLICY "message_attachments_storage_select_member" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING
    (((bucket_id = 'message-attachments'::text) AND storage.allow_any_operation(ARRAY['object.get_authenticated_info'::text, 'object.get_authenticated'::text, 'object.sign'::text,
    'object.sign_many'::text, 'object.copy'::text]) AND private.can_read_message_object(name)));
