-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

ALTER TABLE private.storage_cleanup_queue
  DROP CONSTRAINT storage_cleanup_queue_reason_check;

ALTER TABLE private.storage_cleanup_queue
  ADD CONSTRAINT storage_cleanup_queue_reason_check
    CHECK
    (reason = ANY (ARRAY['post_attachment'::text, 'comment_image'::text, 'group_media'::text, 'profile_media'::text, 'profile_media_activity'::text, 'unreferenced_sweep'::text]));