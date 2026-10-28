ALTER TABLE prescriptions
  ADD CONSTRAINT prescriptions_encrypted_payload_shape_check CHECK (
    encryption_version=0 OR
    (dosage='encrypted' AND route='encrypted' AND frequency='encrypted' AND duration_days=1 AND instructions IS NULL)
  );

ALTER TABLE consultation_note_drafts
  ADD CONSTRAINT consultation_note_drafts_encrypted_payload_shape_check CHECK (
    encryption_version=0 OR
    (symptoms IS NULL AND observations IS NULL AND assessment IS NULL AND follow_up IS NULL AND internal_notes IS NULL)
  );
