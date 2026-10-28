ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS license_number text,
  ADD COLUMN IF NOT EXISTS license_jurisdiction text,
  ADD COLUMN IF NOT EXISTS license_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS license_review_note text;

ALTER TABLE patients ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS auth_phone_codes (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1
);

ALTER TABLE doctors
  ADD CONSTRAINT doctors_license_status_check CHECK (license_status IN ('pending', 'verified', 'rejected'));

ALTER TABLE admin_audit_events DROP CONSTRAINT admin_audit_events_action_check;
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check
  CHECK (action IN ('user.status.changed', 'doctor.approval.changed', 'doctor.license.reviewed'));

ALTER TABLE auth_email_codes DROP CONSTRAINT auth_email_codes_purpose_check;
ALTER TABLE auth_email_codes ADD CONSTRAINT auth_email_codes_purpose_check
  CHECK (purpose IN ('verify_email', 'password_reset', 'admin_mfa_recovery'));
