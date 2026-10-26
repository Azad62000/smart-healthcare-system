CREATE TABLE IF NOT EXISTS care_conversation_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES care_conversations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('list', 'history', 'send', 'read', 'subscribe')),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS care_conversation_access_events_conversation_idx
  ON care_conversation_access_events(conversation_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS care_conversation_access_events_actor_idx
  ON care_conversation_access_events(actor_user_id, occurred_at DESC);
