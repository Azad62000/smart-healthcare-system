CREATE TABLE IF NOT EXISTS care_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(user_id) ON DELETE RESTRICT,
  doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT care_conversations_participants_unique UNIQUE (patient_id, doctor_id)
);

CREATE TABLE IF NOT EXISTS care_messages (
  sequence bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  conversation_id uuid NOT NULL REFERENCES care_conversations(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_message_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT care_messages_idempotency_unique
    UNIQUE (conversation_id, sender_user_id, client_message_id)
);

CREATE TABLE IF NOT EXISTS care_conversation_reads (
  conversation_id uuid NOT NULL REFERENCES care_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_sequence bigint NOT NULL DEFAULT 0 CHECK (last_read_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS care_conversations_patient_idx
  ON care_conversations(patient_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS care_conversations_doctor_idx
  ON care_conversations(doctor_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS care_messages_conversation_sequence_idx
  ON care_messages(conversation_id, sequence DESC);
CREATE INDEX IF NOT EXISTS care_messages_unread_idx
  ON care_messages(conversation_id, sender_user_id, sequence DESC);
