CREATE TABLE IF NOT EXISTS prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(user_id) ON DELETE RESTRICT,
  doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  appointment_id uuid NOT NULL,
  medication_name text NOT NULL CHECK (char_length(medication_name) BETWEEN 1 AND 200),
  dosage text NOT NULL CHECK (char_length(dosage) BETWEEN 1 AND 120),
  route text NOT NULL CHECK (char_length(route) BETWEEN 1 AND 80),
  frequency text NOT NULL CHECK (char_length(frequency) BETWEEN 1 AND 120),
  duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 3650),
  instructions text CHECK (instructions IS NULL OR char_length(instructions) <= 2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prescriptions_appointment_participants_fk
    FOREIGN KEY (appointment_id, patient_id, doctor_id)
    REFERENCES appointments(id, patient_id, doctor_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS prescriptions_patient_issued_idx ON prescriptions(patient_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS prescriptions_doctor_patient_issued_idx ON prescriptions(doctor_id, patient_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS prescription_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES patients(user_id) ON DELETE RESTRICT,
  prescription_id uuid REFERENCES prescriptions(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('list', 'create')),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prescription_access_events_patient_date_idx ON prescription_access_events(patient_id, created_at DESC);
