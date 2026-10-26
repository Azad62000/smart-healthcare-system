CREATE TABLE IF NOT EXISTS admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  target_doctor_id uuid REFERENCES doctors(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('user.status.changed', 'doctor.approval.changed')),
  previous_value text,
  new_value text NOT NULL,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(target_user_id, target_doctor_id) = 1)
);

CREATE INDEX IF NOT EXISTS admin_audit_events_created_idx ON admin_audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_events_actor_idx ON admin_audit_events(actor_user_id, created_at DESC);
