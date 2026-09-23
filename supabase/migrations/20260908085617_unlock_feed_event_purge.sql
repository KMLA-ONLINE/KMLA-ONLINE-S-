-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER TABLE private.feed_bump_events
  DROP CONSTRAINT feed_bump_events_comment_id_fkey;

ALTER TABLE private.feed_bump_events
  DROP CONSTRAINT feed_bump_events_post_id_fkey;

ALTER TABLE private.post_reaction_count_events
  DROP CONSTRAINT post_reaction_count_events_post_id_fkey;

CREATE OR REPLACE FUNCTION private.capture_post_reaction_count_event()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if tg_op = 'INSERT' then
    insert into private.post_reaction_count_events (post_id, delta, occurred_at)
    values (new.post_id, 1, new.created_at);
  elsif tg_op = 'DELETE'
    and coalesce(
      pg_catalog.current_setting('app.feed_event_purge', true), ''
    ) <> 'on' then
    insert into private.post_reaction_count_events (post_id, delta)
    values (old.post_id, -1);
  end if;
  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION private.reject_feed_event_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if "tg_op" = 'DELETE'
    and "pg_catalog"."current_setting"('app.feed_event_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'feed ranking events are append-only' using errcode = '55000';
end;
$function$;

ALTER TABLE private.feed_bump_events
  ADD CONSTRAINT feed_bump_events_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.post_comments(id) ON DELETE CASCADE;

ALTER TABLE private.feed_bump_events
  ADD CONSTRAINT feed_bump_events_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;

ALTER TABLE private.post_reaction_count_events
  ADD CONSTRAINT post_reaction_count_events_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;