CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  given_name text NOT NULL CHECK (char_length(given_name) BETWEEN 1 AND 80),
  family_name text NOT NULL CHECK (char_length(family_name) BETWEEN 1 AND 80),
  date_of_birth date NOT NULL,
  phone text NOT NULL CHECK (char_length(phone) BETWEEN 7 AND 24),
  address_line text,
  city text,
  postal_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
