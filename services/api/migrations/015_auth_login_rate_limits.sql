CREATE TABLE IF NOT EXISTS auth_login_attempt_limits (
  bucket_hash text PRIMARY KEY CHECK (bucket_hash ~ '^[a-f0-9]{64}$'),
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 11),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_login_attempt_limits_expires_idx
  ON auth_login_attempt_limits(expires_at);
