ALTER TABLE medgemma_messages ADD COLUMN sequence bigserial NOT NULL;
DROP INDEX medgemma_messages_conversation_created_idx;
CREATE INDEX medgemma_messages_conversation_sequence_idx
  ON medgemma_messages(conversation_id, sequence DESC);
