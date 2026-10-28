ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_event_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_event_type_check
  CHECK (event_type IN ('created', 'cancelled', 'status_changed', 'doctor_joined'));
