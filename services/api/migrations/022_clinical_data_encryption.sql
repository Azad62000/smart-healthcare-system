ALTER TABLE consultation_records
  ADD COLUMN encryption_version smallint NOT NULL DEFAULT 0 CHECK (encryption_version IN (0, 1));
ALTER TABLE consultation_records DROP CONSTRAINT consultation_records_note_check;
ALTER TABLE consultation_records DROP CONSTRAINT consultation_records_diagnosis_check;
ALTER TABLE consultation_records
  ADD CONSTRAINT consultation_records_note_check CHECK (
    (encryption_version=0 AND char_length(note) BETWEEN 1 AND 10000) OR
    (encryption_version=1 AND char_length(note) BETWEEN 1 AND 100000 AND note LIKE 'shc1.%')
  ),
  ADD CONSTRAINT consultation_records_diagnosis_check CHECK (
    (encryption_version=0 AND (diagnosis IS NULL OR char_length(diagnosis)<=2000)) OR
    (encryption_version=1 AND diagnosis IS NULL)
  );

ALTER TABLE prescriptions
  ADD COLUMN encryption_version smallint NOT NULL DEFAULT 0 CHECK (encryption_version IN (0, 1));
ALTER TABLE prescriptions DROP CONSTRAINT prescriptions_medication_name_check;
ALTER TABLE prescriptions
  ADD CONSTRAINT prescriptions_medication_name_check CHECK (
    (encryption_version=0 AND char_length(medication_name) BETWEEN 1 AND 200) OR
    (encryption_version=1 AND char_length(medication_name) BETWEEN 1 AND 12000 AND medication_name LIKE 'shc1.%')
  );

ALTER TABLE consultation_note_drafts
  ADD COLUMN encryption_version smallint NOT NULL DEFAULT 0 CHECK (encryption_version IN (0, 1));
ALTER TABLE consultation_note_drafts DROP CONSTRAINT consultation_note_drafts_summary_check;
ALTER TABLE consultation_note_drafts
  ADD CONSTRAINT consultation_note_drafts_summary_check CHECK (
    (encryption_version=0 AND char_length(summary) BETWEEN 1 AND 10000) OR
    (encryption_version=1 AND char_length(summary) BETWEEN 1 AND 400000 AND summary LIKE 'shc1.%')
  );
ALTER TABLE consultation_note_drafts DROP CONSTRAINT consultation_note_drafts_symptoms_check;
ALTER TABLE consultation_note_drafts DROP CONSTRAINT consultation_note_drafts_observations_check;
ALTER TABLE consultation_note_drafts DROP CONSTRAINT consultation_note_drafts_assessment_check;
ALTER TABLE consultation_note_drafts DROP CONSTRAINT consultation_note_drafts_follow_up_check;
ALTER TABLE consultation_note_drafts DROP CONSTRAINT consultation_note_drafts_internal_notes_check;
ALTER TABLE consultation_note_drafts
  ADD CONSTRAINT consultation_note_drafts_symptoms_check CHECK (encryption_version=1 OR symptoms IS NULL OR char_length(symptoms)<=5000),
  ADD CONSTRAINT consultation_note_drafts_observations_check CHECK (encryption_version=1 OR observations IS NULL OR char_length(observations)<=5000),
  ADD CONSTRAINT consultation_note_drafts_assessment_check CHECK (encryption_version=1 OR assessment IS NULL OR char_length(assessment)<=5000),
  ADD CONSTRAINT consultation_note_drafts_follow_up_check CHECK (encryption_version=1 OR follow_up IS NULL OR char_length(follow_up)<=5000),
  ADD CONSTRAINT consultation_note_drafts_internal_notes_check CHECK (encryption_version=1 OR internal_notes IS NULL OR char_length(internal_notes)<=10000);
