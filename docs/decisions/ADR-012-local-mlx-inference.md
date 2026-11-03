# ADR-012: Local MLX inference adapter

- Status: accepted for the local operator prototype; one host generation and recovery experiment passed
- Date: 2026-11-03

## Problem

The user redirected the product from a health-only control surface toward actual AI and selected local MLX on macOS. The user then reported losing earlier turns because each `ai ask` invocation sent only its current prompt. The runtime needs to remain replaceable and must not be installed in the Linux context-engine container.

## Constraints

- MLX runs on Apple Silicon/macOS with Metal; the context engine is containerized Linux.
- There is no authenticated public conversation/inference API yet.
- Project storage, authorization-aware retrieval and deterministic context compilation are future phases.
- Never present an ungrounded response as a project-grounded answer or fabricate model output/usage.

## Options

1. Import MLX into NestJS or FastAPI: rejected because it couples application runtimes to a host-specific native stack and does not fit the Linux container.
2. Add a local model server behind an application-owned transport adapter: selected because it isolates the host runtime and supports another provider later.
3. Add a browser-facing inference route now: deferred because server-side identity and scoped context retrieval are not implemented.

## Decision

Use `mlx_lm.server` on the Mac and an explicit context CLI command backed by a small Python HTTP adapter. In an interactive terminal, `context ai ask` stays open and sends prior user/assistant turns with each request; `:reset` explicitly clears the in-process history. Piped input remains one-shot, and history is not persisted after exit. The CLI defaults to the verified cached Qwen3 8B 4-bit model and an 8,192-token budget; operators can override both for another model. The adapter accepts only HTTP loopback endpoints, disables proxy and redirect behavior, limits prompt characters, response bytes, output tokens and timeout, and returns safe errors without logging prompts. It adds the host's current local date and time as system context. It estimates prompt tokens from UTF-8 bytes plus a configured chat-template reserve, reserves output capacity and rejects when the configured model budget would be exceeded. The estimate is labeled and is not exact tokenizer usage. MLX is not installed in the context-engine virtualenv or container. This is intentionally ungrounded raw generation; retrieval and source citation remain separate capabilities.

## Consequences and failure behavior

The operator must start the local server; the CLI uses the verified default model unless overridden. Missing, timed-out, malformed or unavailable responses fail visibly; the CLI has no fallback answer. Interactive history is bounded by the configured context budget and is lost on exit or explicit reset. A disconnected process may leave an interrupted request; the caller timeout bounds the CLI wait, but the provider may continue generation. The adapter does not retry automatically because duplicate local generation can consume substantial memory and compute.

Thirteen adapter contract tests passed. The cached Qwen3 8B 4-bit model initialized on host Metal, returned a real response with default model and budget settings, failed visibly when the server was stopped, and generated again after restart. The CLI answered a current-date prompt using local system-date context. A real interactive two-turn check showed the second response retained the first turn's project name. This proves short-prompt operation; model quality, sustained resource use, concurrency, persistent history and long-context behavior remain unmeasured. MLX-LM's local server is not a production security boundary; loopback binding and a trusted Mac process are assumed.

## Scaling, observability, and alternatives

One host server is appropriate for a local learning workflow. Concurrency, memory pressure and model-loading time must be measured before adding a queue or another inference node. Provider-reported usage is currently not persisted or displayed; token counts are unknown until instrumentation is added. An OpenAI-compatible adapter keeps the interface replaceable but does not guarantee provider feature parity, especially for streaming and tool calls. A future provider contract should preserve cancellation, timeouts and provider-specific usage provenance.

## Interview prompt

How would you add project-grounded generation to this path while proving source authorization and context-budget compliance before inference, and how would you distinguish estimated token counts from provider-reported usage?
