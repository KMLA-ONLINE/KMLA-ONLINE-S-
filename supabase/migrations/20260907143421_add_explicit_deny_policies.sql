-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

CREATE POLICY storage_cleanup_queue_deny_client_access ON private.storage_cleanup_queue
  USING (false)
  WITH CHECK (false);

CREATE POLICY storage_cleanup_runs_deny_client_access ON private.storage_cleanup_runs
  USING (false)
  WITH CHECK (false);

CREATE POLICY profile_media_objects_deny_client_access ON public.profile_media_objects
  USING (false)
  WITH CHECK (false);