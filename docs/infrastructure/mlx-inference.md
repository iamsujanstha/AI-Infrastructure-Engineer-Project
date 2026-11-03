# Local MLX inference

## Scope

The local AI slice supports interactive CLI chat and tokenless, loopback browser chat to `mlx_lm.server` on the same Mac. It has no canned response path. Browser chat history is persisted in the app's PostgreSQL conversation tables, but the model does not retrieve project sources or cite repository evidence. Do not describe it as project-aware Q&A. Project-grounded answers remain gated on the context storage, retrieval, and compiler phases.

The context CLI and NestJS API are callers. NestJS depends on the application-owned `InferenceProvider` contract; `MlxProvider` is its current adapter. The MLX-LM process runs separately on macOS because the context engine's container is Linux and MLX needs host Metal. The API adapter accepts only HTTP loopback URLs, disables redirects, bounds responses/output tokens and timeout, and does not log prompt text. The browser chat requires a configured `Origin`, a loopback API bind and non-production mode. This is a local-browser boundary, not authentication; local programs can bypass it.

## Start and use

Install MLX-LM into a macOS Apple Silicon Python environment using its official installation guidance. This repository does not install MLX into the Linux context-engine environment.

Start the host server in one terminal. The chosen model is already present in this machine's Hugging Face cache, so offline mode prevents an accidental download:

```sh
export HF_HUB_OFFLINE=1
mlx_lm.server --model mlx-community/Qwen3-8B-4bit
```

The MLX-LM server defaults to `127.0.0.1:8080`. Keep that listener on loopback. In a second terminal from the repository root:

```sh
npm run build -w @local-ai/context-cli
printf '%s' 'Explain how this project handles PostgreSQL migrations.' | npm run context -- ai ask
```

For interactive use, run `npm run context -- ai ask` without a pipe. The command stays open and includes previous user/assistant turns in each model request. Enter `:reset` to clear this session's history or `:quit` to exit. History is held in memory for this process; it is not persisted after exit. Piped input remains one-shot. The CLI defaults to the verified local model `mlx-community/Qwen3-8B-4bit` and an 8,192-token budget. Set `MLX_MODEL` and `MLX_CONTEXT_WINDOW_TOKENS` in the CLI terminal when using a different model; keep the budget at or below that model's supported maximum. The cached Qwen config reports 40,960 maximum positions. The adapter estimates prompt usage as UTF-8 byte length plus a 256-token chat-template reserve, reserves the configured output tokens (512 by default), and rejects before sending when their sum exceeds the context window. This is a conservative estimate, not the model tokenizer's exact count. Set `MLX_BASE_URL` only to an HTTP loopback URL (default `http://127.0.0.1:8080`), `MLX_TIMEOUT_SECONDS` (default 180, max 600), and `MLX_MAX_OUTPUT_TOKENS` (default 512, max 4096) when needed. The independent 32,000-character cap bounds transport input.

The CLI and API add the host's current local date and time as system context so time questions do not rely on the model's training data. The browser model selector is populated from the live `/v1/models` response; the selected model ID must match one reported by MLX-LM. API config comes from `.env` with `MLX_*` settings. The API reports a UTF-8-byte prompt estimate plus output reserve; it does not claim tokenizer-exact or provider-reported usage. The browser reloads history from PostgreSQL and sends a bounded recent history to the model for each request. The CLI's interactive transcript remains process-local.

Qwen3 thinking mode is disabled by default in the NestJS MLX adapter so its bounded output is spent on the answer instead of hidden reasoning. Set `MLX_QWEN3_ENABLE_THINKING=true` in `.env` to opt back in. The adapter applies this Qwen3-specific template setting only to model IDs containing `Qwen3`; other selected model families are unaffected. MLX-LM supports `chat_template_kwargs` on chat completion requests and forwards those values to its chat template ([server request handling](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/server.py), [tokenizer template handling](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/tokenizer_utils.py)).

## Browser use

Start the API and web processes using the local-development guide. The chat connects to the local API automatically; change models using the live provider model selector. `/system` retains the separate dependency diagnostic view. Never expose the API or MLX listener beyond loopback. Browser chat currently does not read the checked-out project, scanner graph, or stored context. An installing application cannot yet ask for project-grounded answers; complete storage, permission-scoped retrieval, deterministic cited context compilation, evaluation and identity before publishing an SDK or integration endpoint.

## Failure and recovery experiment

1. Start the MLX server and issue a short prompt. Confirm a real response is returned.
2. Stop the MLX process with Ctrl-C.
3. Issue another prompt. The CLI should exit nonzero with a safe unavailable/timeout message and must not print a fabricated answer.
4. Restart the same model server and retry. A successful response verifies recovery.

The adapter contract suite passed tests covering success, malformed response, HTTP failure, redirect blocking, endpoint allowlist, prompt limits, model selection, history validation, preflight context-budget rejection, and Qwen3 thinking-template selection. These tests validate policy/transport, not general model quality. On 2026-11-03 a short Qwen3 request through the API took 36.82 seconds with the model's default thinking behavior; an MLX stream probe showed `reasoning` chunks. With `enable_thinking:false`, an API request for an exact short answer took 1.12 seconds, and a typical three-bullet answer took 4.69 seconds. These are individual local measurements, not a throughput guarantee. During verification, MLX was found not listening and the API correctly returned 503; the same cached Qwen3 server was restarted in offline mode and subsequent model listing and generation succeeded. The cause of that stopped process is unknown. Earlier local tests also verified model recovery, current-date context, and interactive two-turn history. This does not measure sustained load, concurrency or long-context behavior.

## Decision and learning record

The adapter uses MLX-LM's OpenAI-compatible chat completion interface rather than importing `mlx` into NestJS or installing it in the Linux service container. This keeps the Mac-specific runtime replaceable and lets application code remain independent of MLX packages. The CLI and browser chat are local operator surfaces; the browser endpoint is loopback/origin restricted, not authenticated, and has no project-context retrieval.

The current bottleneck is model memory and generation throughput on the selected Mac, followed by the single-process server's concurrency and context capacity. At 10x request volume, collect real queue-wait, prefill/TTFT, generation, cancellation and provider-reported token usage before deciding whether to serialize requests, add a bounded queue, or move to a replaceable inference node. MLX-LM is intended as a local endpoint and does not provide production-grade security; loopback binding and a trusted local process are assumptions.

Interview question: How would you add grounded repository answers while preventing unauthorized source chunks, prompt-injected instructions and oversized context from reaching the model, without making the model provider own authorization policy?
