# ADR-015: Persist local browser chat as conversations

- **Status:** Accepted for localhost development
- **Date:** 2026-11-03

## Context

The browser chat kept every turn only in React state, so refreshes and new tabs lost the transcript. Hermes' curated `MEMORY.md` and `USER.md` are not an appropriate transcript store, and the Hermes MCP adapter only reads project evidence. PostgreSQL already has owner-scoped conversations, messages, and message parts, with application repositories that record turn lifecycle state.

## Decision

Route the local browser chat through the existing conversation services and persist it in PostgreSQL. A server-owned local development principal supplies the owner scope; the browser never supplies an owner ID or token. Store each user prompt and a pending assistant message before calling inference. On success, persist and finalize the assistant response. On provider failure, finalize the assistant message as failed while keeping the submitted prompt. On reconnect, load the newest 100 messages; inference receives at most 49 completed user/assistant pairs plus the new prompt, then the existing context-budget policy accepts or rejects the request.

This local principal is a single-user development convenience protected only by the loopback/origin guard. It is not authentication. Hermes memory remains separate, and no chat turn is mirrored into Hermes' memory files.

## Consequences and limitations

- Browser chat survives refreshes and can switch among the 50 most recent active conversations.
- The database and migrations must be available for chat history. An inference failure leaves a durable user prompt and failed assistant turn.
- Messages are retained in PostgreSQL until an operator removes the relevant database data; there is no user-facing deletion or retention workflow yet.
- History display is capped at the latest 100 messages. The model receives no more than 49 complete previous pairs, and the byte-based context budget may reject large histories. Start a new chat when that happens.
- Any local process that can call the loopback API can reach this single local owner's conversations. Do not expose this prototype over a network or use it for multiple users.
- The existing schema and owner-scoped repositories are reused; no schema migration is introduced.

## Failure and scale

Conversation start and user/pending-assistant allocation are transactional. Provider failure is recorded as a failed assistant message. If PostgreSQL fails after inference returns but before the assistant response is committed, the generated text can be lost or the row may remain streaming; reconciliation is not implemented. A single local operator is the only measured operating point. At larger scale, add identity, authorization, deletion/retention, streaming/cancellation recovery, and workload measurements before introducing queueing or other infrastructure.

## Interview question

Why should a transcript be stored as ordered conversation messages instead of copied into Hermes' curated memory files, and what consistency gap remains between inference completion and committing the assistant response?
