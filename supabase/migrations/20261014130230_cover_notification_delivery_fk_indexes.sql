CREATE INDEX notification_delivery_attempts_delivery_idx ON private.notification_delivery_attempts USING btree (delivery_id);

CREATE INDEX notification_delivery_outbox_notification_idx ON private.notification_delivery_outbox USING btree (notification_id)
  WHERE (notification_id IS NOT NULL);
