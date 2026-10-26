CREATE TABLE IF NOT EXISTS admin_mfa (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted text,
  pending_secret_encrypted text,
  enabled boolean NOT NULL DEFAULT false,
  last_totp_step bigint NOT NULL DEFAULT -1,
  CHECK (NOT enabled OR secret_encrypted IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS admin_mfa_recovery_codes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('enroll', 'login')),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_mfa_challenges_expires_idx ON auth_mfa_challenges(expires_at);

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS mfa_verified boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS admin_mfa_rate_limits (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  failure_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz
);
