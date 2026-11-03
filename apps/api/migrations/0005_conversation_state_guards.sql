-- Keep retry and regeneration messages connected to the user input they repeat.
ALTER TABLE messages
  ADD CONSTRAINT messages_repeated_generation_has_source_ck
  CHECK (generation_kind = 'original' OR reply_to_message_id IS NOT NULL);

-- Enforce the single active assistant response invariant even for future write paths.
CREATE UNIQUE INDEX messages_one_streaming_assistant_per_conversation_uq
  ON messages (conversation_id)
  WHERE role = 'assistant' AND status = 'streaming';
