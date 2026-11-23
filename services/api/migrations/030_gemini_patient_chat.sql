CREATE TABLE gemini_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gemini_conversations_patient_updated_idx
  ON gemini_conversations(patient_user_id, updated_at DESC);

CREATE TABLE gemini_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigserial NOT NULL,
  conversation_id uuid NOT NULL REFERENCES gemini_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (content LIKE 'shc1.%' AND char_length(content) <= 140000),
  encryption_version smallint NOT NULL DEFAULT 1 CHECK (encryption_version = 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gemini_messages_conversation_sequence_idx
  ON gemini_messages(conversation_id, sequence DESC);
