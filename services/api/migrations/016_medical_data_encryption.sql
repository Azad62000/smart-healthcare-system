DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='care_messages'::regclass AND conname='care_messages_body_check'
  ) THEN
    ALTER TABLE care_messages DROP CONSTRAINT care_messages_body_check;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='care_messages'::regclass AND conname='care_messages_body_length_check'
  ) THEN
    ALTER TABLE care_messages
      ADD CONSTRAINT care_messages_body_length_check
      CHECK (char_length(body) BETWEEN 1 AND 30000);
  END IF;
END
$$;

ALTER TABLE care_messages
  ADD COLUMN IF NOT EXISTS encryption_version smallint NOT NULL DEFAULT 0
  CHECK (encryption_version IN (0,1));

ALTER TABLE appointment_documents
  ADD COLUMN IF NOT EXISTS storage_format text NOT NULL DEFAULT 'legacy-plaintext'
  CHECK (storage_format IN ('legacy-plaintext','aes-256-gcm-v1'));
