# ADR-013: Local browser chat with a replaceable inference provider

- Status: accepted and implemented as a local operator prototype
- Date: 2026-11-03

## Problem

The user needs to ask the local model from the browser rather than reopening a terminal command, and change the model later without rewriting chat policy. The browser also needs an honest path toward future project-context integration.

## Constraints

- MLX remains a host-local macOS process; neither web nor API should expose it beyond loopback.
- The local single-user browser workflow should not require copying a token.
- The API may accept only user/assistant chat turns, validate model IDs against the live provider, reserve output budget and reject oversized history.
- Until project storage, scoped retrieval, deterministic context compilation, evaluation and tenant identity exist, this feature must disclose that no repository context is attached.
- Model adapters must not own chat policy or project authorization.

## Options

1. Send browser requests directly to MLX-LM: rejected because the provider endpoint has no application-owned auth, model policy, budget enforcement or replaceable boundary.
2. Add a NestJS local chat capability with a provider port and MLX adapter, restricted to loopback and the configured browser origin: selected. It reuses the control plane and creates an adapter boundary for another model provider later.
3. Route through the persisted conversation subsystem now: deferred because that subsystem's identity and scope model does not yet represent the operator's local chat; mixing it would falsely imply identity-safe persistence.

## Decision

Add `InferenceProvider` as a narrow application-owned interface with live model listing and non-streaming completion. Bind it to `MlxProvider` through Nest dependency injection. `ChatService` validates turn order/model selection, inserts local date/time context, computes and enforces a labeled UTF-8-byte prompt estimate with output reserve, and maps provider failures to safe API errors. `LocalChatOriginGuard` allows `/api/v1/chat/*` only when the API is configured for a loopback bind, the runtime is not production, and request `Origin` exactly matches `CORS_ORIGINS`. This removes the manual token prompt for the local workflow. These are browser-origin/network-scope checks, not authentication: local processes can call the loopback API directly. Remote or multi-user deployment requires real identity and object-level authorization before chat is enabled. The frontend model dropdown uses the API's live list and keeps conversation turns in React memory only. The old dependency view moves to `/system`.

For future app integration, keep project context a separate application service/endpoint from provider selection. After Phases 5–8 supply durable generations, permission-scoped retrieval, cited context compilation and evals, the context API can expose a stable versioned contract, then a thin TypeScript SDK/agent adapter can invoke it. Every request will need tenant/project/user/environment/permission scope established by real identity. Do not pass repository paths from consumers or let the model select its own sources.

## Consequences and failure behavior

The browser keeps multiple turns while its tab remains open, but there is no persisted history, cancellation, streaming, customer identity, citations or project grounding. Disallowed origins return 403, unsupported model IDs and over-budget input return 400, and local provider failures map to safe 502/503/504 errors. Model availability is only as current as the latest API model-list request. UI statuses reflect successful API responses, not inferred runtime health. The API still trusts local programs, so bind it to loopback and do not treat the origin check as authentication.

Unit tests cover browser-origin and local-bind policy, model allowlisting, turn order, budget rejection, provider-unavailable mapping and MLX model-template settings. The API/web typechecks and builds pass. Local timing identified Qwen3's default hidden reasoning as the main latency source: one short non-streamed API completion took 36.82 seconds and a direct stream showed reasoning deltas; after disabling thinking, a short completion took 1.12 seconds and a three-bullet response took 4.69 seconds. These are individual observations, not a load benchmark. During verification MLX was found stopped; the API returned 503, then the cached offline server was restarted and API model listing/completion succeeded. The reason it had stopped was not established. No load/concurrency, model-switch-during-generation, disconnect/cancellation or browser persistence testing is claimed.

## Scaling, observability, and alternatives

The current API waits for one complete model response and keeps conversation data in each browser request; larger histories increase request body, prompt estimation and prefill work. Qwen3 thinking can spend output tokens on hidden reasoning, so the MLX adapter disables it by default for this family; operators can opt in through `MLX_QWEN3_ENABLE_THINKING`. At higher usage, measure queue wait, prefill/TTFT, generation time, provider-reported usage, memory, cancellation and concurrent requests before adding a bounded queue or streaming. A provider swap requires implementing the narrow interface and preserving model discovery, timeout, safe error, cancellation and usage provenance semantics. The local-origin check is not suitable for deployment; use a real identity/session system and object-level authorization before remote exposure.

## Interview prompt

How do you retain provider replaceability while keeping authorization and context assembly outside vendor adapters, and how would you evolve a loopback-only origin-restricted prototype into scoped multi-tenant auth without exposing repository source to unauthorized consumers?
