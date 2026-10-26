CREATE TABLE IF NOT EXISTS consultation_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(user_id) ON DELETE RESTRICT,
  doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  appointment_id uuid,
  consultation_at timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 10000),
  diagnosis text CHECK (diagnosis IS NULL OR char_length(diagnosis) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultation_records_appointment_participants_fk
    FOREIGN KEY (appointment_id, patient_id, doctor_id)
    REFERENCES appointments(id, patient_id, doctor_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS consultation_records_patient_date_idx ON consultation_records(patient_id, consultation_at DESC);
CREATE INDEX IF NOT EXISTS consultation_records_doctor_date_idx ON consultation_records(doctor_id, consultation_at DESC);
CREATE INDEX IF NOT EXISTS consultation_records_appointment_idx ON consultation_records(appointment_id) WHERE appointment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS health_record_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES patients(user_id) ON DELETE RESTRICT,
  record_id uuid REFERENCES consultation_records(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('list', 'read', 'create')),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS health_record_access_events_patient_date_idx ON health_record_access_events(patient_id, created_at DESC);
