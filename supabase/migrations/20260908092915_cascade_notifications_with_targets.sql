-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_comment_id_fkey;

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_post_id_fkey;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.post_comments(id) ON DELETE CASCADE;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;