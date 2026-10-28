CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'appointment_booked','appointment_confirmed','appointment_rescheduled','appointment_cancelled',
    'appointment_reminder','video_room_open','doctor_joined','new_message','document_shared',
    'health_record_created','prescription_created','admin_security'
  )),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 180),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recipient_user_id,event_key)
);

CREATE INDEX email_outbox_pending_idx ON email_outbox(next_attempt_at,created_at)
  WHERE status IN ('pending','failed');
