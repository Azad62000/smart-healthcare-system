CREATE TABLE IF NOT EXISTS appointment_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL UNIQUE,
  patient_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_feedback_participant_fk
    FOREIGN KEY (appointment_id, patient_id, doctor_id)
    REFERENCES appointments (id, patient_id, doctor_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS appointment_feedback_doctor_idx
  ON appointment_feedback (doctor_id, created_at DESC);
