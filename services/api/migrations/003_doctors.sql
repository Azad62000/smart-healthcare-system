CREATE TABLE IF NOT EXISTS doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  given_name text NOT NULL CHECK (char_length(given_name) BETWEEN 1 AND 80),
  family_name text NOT NULL CHECK (char_length(family_name) BETWEEN 1 AND 80),
  specialization text NOT NULL CHECK (char_length(specialization) BETWEEN 2 AND 100),
  qualification text CHECK (qualification IS NULL OR char_length(qualification) <= 160),
  experience_years smallint CHECK (experience_years IS NULL OR experience_years BETWEEN 0 AND 60),
  bio text CHECK (bio IS NULL OR char_length(bio) <= 1200),
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS doctors_directory_idx ON doctors(specialization, family_name) WHERE approval_status = 'approved';

CREATE TABLE IF NOT EXISTS doctor_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (doctor_id, starts_at, ends_at)
);

CREATE INDEX IF NOT EXISTS doctor_availability_doctor_start_idx ON doctor_availability(doctor_id, starts_at);
