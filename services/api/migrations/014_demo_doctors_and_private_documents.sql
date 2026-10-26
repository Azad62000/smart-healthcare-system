ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS synthetic_dataset_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS consultation_modes text[] NOT NULL DEFAULT ARRAY['in_person','video']::text[],
  ADD COLUMN IF NOT EXISTS consultation_fee_inr integer,
  ADD COLUMN IF NOT EXISTS accepting_appointments boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='doctors_synthetic_dataset_id_check'
  ) THEN
    ALTER TABLE doctors ADD CONSTRAINT doctors_synthetic_dataset_id_check
      CHECK (synthetic_dataset_id IS NULL OR is_synthetic);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS doctors_demo_recommendation_idx
  ON doctors(specialization, city, consultation_fee_inr)
  WHERE approval_status='approved' AND accepting_appointments=true;

CREATE TABLE IF NOT EXISTS appointment_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL,
  patient_id uuid NOT NULL REFERENCES patients(user_id) ON DELETE RESTRICT,
  doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  uploader_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key uuid NOT NULL UNIQUE,
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  media_type text NOT NULL CHECK (media_type IN ('application/pdf','image/jpeg','image/png')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 25000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (appointment_id, patient_id, doctor_id)
    REFERENCES appointments(id, patient_id, doctor_id) ON DELETE RESTRICT,
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);

CREATE INDEX IF NOT EXISTS appointment_documents_appointment_created_idx
  ON appointment_documents(appointment_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS appointment_document_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES appointment_documents(id) ON DELETE RESTRICT,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('upload','list','download','delete')),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointment_document_access_events_document_idx
  ON appointment_document_access_events(document_id, occurred_at DESC);
