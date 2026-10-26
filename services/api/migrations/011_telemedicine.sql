ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS appointment_type text NOT NULL DEFAULT 'in_person'
    CHECK (appointment_type IN ('in_person', 'video')),
  ADD COLUMN IF NOT EXISTS scheduling_note text
    CHECK (scheduling_note IS NULL OR char_length(scheduling_note) <= 1000),
  ADD COLUMN IF NOT EXISTS admin_note text
    CHECK (admin_note IS NULL OR char_length(admin_note) <= 2000);

CREATE TABLE IF NOT EXISTS teleconsultations (
  appointment_id uuid PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
  room_name text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'ready', 'in_progress', 'completed', 'cancelled', 'no_show')),
  doctor_joined_at timestamptz,
  patient_joined_at timestamptz,
  actual_started_at timestamptz,
  actual_ended_at timestamptz,
  termination_reason text
    CHECK (termination_reason IS NULL OR char_length(termination_reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actual_ended_at IS NULL OR actual_started_at IS NOT NULL),
  CHECK (actual_ended_at IS NULL OR actual_ended_at >= actual_started_at)
);

CREATE TABLE IF NOT EXISTS teleconsultation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('doctor_joined', 'patient_joined', 'consultation_started', 'consultation_ended')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  detail text CHECK (detail IS NULL OR char_length(detail) <= 200)
);

CREATE INDEX IF NOT EXISTS teleconsultation_events_appointment_idx
  ON teleconsultation_events(appointment_id, occurred_at);

CREATE TABLE IF NOT EXISTS consultation_note_drafts (
  appointment_id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES patients(user_id) ON DELETE RESTRICT,
  doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 10000),
  symptoms text CHECK (symptoms IS NULL OR char_length(symptoms) <= 5000),
  observations text CHECK (observations IS NULL OR char_length(observations) <= 5000),
  assessment text CHECK (assessment IS NULL OR char_length(assessment) <= 5000),
  follow_up text CHECK (follow_up IS NULL OR char_length(follow_up) <= 5000),
  internal_notes text CHECK (internal_notes IS NULL OR char_length(internal_notes) <= 10000),
  finalized_at timestamptz,
  finalized_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  record_id uuid REFERENCES consultation_records(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (appointment_id, patient_id, doctor_id)
    REFERENCES appointments(id, patient_id, doctor_id) ON DELETE CASCADE
);
