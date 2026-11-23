CREATE TABLE medgemma_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX medgemma_conversations_patient_updated_idx
  ON medgemma_conversations(patient_user_id, updated_at DESC);

CREATE TABLE medgemma_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES medgemma_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (content LIKE 'shc1.%' AND char_length(content) <= 140000),
  encryption_version smallint NOT NULL DEFAULT 1 CHECK (encryption_version = 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX medgemma_messages_conversation_created_idx
  ON medgemma_messages(conversation_id, created_at, id);
