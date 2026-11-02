-- Track the user message an assistant response answers and distinguish retries from regenerations.
ALTER TABLE messages
  ADD COLUMN reply_to_message_id uuid,
  ADD COLUMN generation_attempt integer NOT NULL DEFAULT 1 CHECK (generation_attempt > 0),
  ADD COLUMN generation_kind text NOT NULL DEFAULT 'original'
    CHECK (generation_kind IN ('original', 'retry', 'regeneration')),
  ADD CONSTRAINT messages_reply_same_conversation_fk
    FOREIGN KEY (reply_to_message_id, conversation_id, owner_user_id)
    REFERENCES messages(id, conversation_id, owner_user_id) ON DELETE RESTRICT,
  ADD CONSTRAINT messages_generation_assistant_only_ck
    CHECK (role = 'assistant' OR (reply_to_message_id IS NULL AND generation_attempt = 1 AND generation_kind = 'original'));

CREATE INDEX messages_reply_lineage_idx
  ON messages (reply_to_message_id, generation_attempt DESC, sequence DESC)
  WHERE reply_to_message_id IS NOT NULL;
