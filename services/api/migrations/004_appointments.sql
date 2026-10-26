CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(user_id) ON DELETE RESTRICT,
  doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'confirmed', 'cancelled', 'completed', 'no_show')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  cancellation_reason text CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) <= 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CONSTRAINT appointments_id_patient_doctor_unique UNIQUE (id, patient_id, doctor_id),
  CONSTRAINT appointments_doctor_no_overlap EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('booked', 'confirmed')),
  CONSTRAINT appointments_patient_no_overlap EXCLUDE USING gist (
    patient_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('booked', 'confirmed'))
);

CREATE INDEX IF NOT EXISTS appointments_patient_start_idx ON appointments(patient_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS appointments_doctor_start_idx ON appointments(doctor_id, starts_at);

CREATE TABLE IF NOT EXISTS appointment_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('booked', 'confirmed', 'cancelled', 'completed', 'no_show')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointment_status_history_appointment_idx ON appointment_status_history(appointment_id, created_at);
