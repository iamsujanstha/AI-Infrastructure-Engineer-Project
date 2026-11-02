# Request Lifecycle

## Phase 1 HTTP lifecycle

```mermaid
sequenceDiagram
    participant B as Browser / caller
    participant N as NestJS HTTP process
    participant M as Middleware
    participant C as Controller
    participant D as Dependency

    B->>N: HTTP request
    N->>M: Parse bounded configuration and middleware chain
    M->>M: Generate/validate request ID
    M->>M: JSON request log, security headers, CORS, rate limit
    M->>C: Versioned API route or version-neutral health route
    C->>D: Dependency probe (if requested)
    D-->>C: Success or failure
    C-->>B: Safe response + x-request-id
    N->>N: Structured completion log
```

The exact Express/Nest internal ordering is defined in `apps/api/src/main.ts`; the diagram describes the intended logical stages, not every framework callback. Body parsing is bounded to 64 KiB. CORS restricts browser origins but does not authenticate callers.

## Phase 1 health semantics

`/health` answers whether this process can handle HTTP. Database, Redis, and inference checks contact their dependency and report readiness independently. A database outage should not make the liveness probe fail and cause an orchestrator restart loop; it should make the database readiness probe fail. These endpoint checks are simple synchronous probes and currently have no circuit breaker or cache.

The request ID correlates the caller's response, request completion log, and sanitized exception body. An invalid incoming ID is replaced. The ID does not prove caller identity and must not become an authorization token.

## Target inference lifecycle (not implemented yet)

```mermaid
sequenceDiagram
    participant U as User
    participant A as API
    participant C as Context Manager
    participant P as PostgreSQL / retrieval
    participant G as Agent / model adapter
    participant I as Inference node

    U->>A: Submit request
    A->>A: Authenticate, authorize, assign request/run IDs
    A->>C: Build bounded context with reserved output budget
    C->>P: Load scoped conversation and candidate memories
    P-->>C: Durable records and retrieval candidates
    C->>C: Rank, account tokens, explain included/omitted items
    C-->>A: Validated bounded inference request
    A->>G: Provider-neutral agent request
    G->>I: Provider protocol request
    I-->>G: Streamed events and usage
    G-->>A: Provider-neutral events
    A-->>U: Correlated stream and persisted outcome
```

This is a future target. Phase 1 does not implement inference, conversations, authentication, context budgeting, or streaming. Each future stage must define cancellation, partial result persistence, retry behavior, token accounting source, timeout budget, and failure response before being considered reliable.

## Interview prompts

- Why separate liveness from dependency readiness?
- How should request IDs propagate into queue jobs and streaming events?
- Where should an inference timeout budget be spent: queue wait, prompt processing, generation, or all three?
- Which failures are safe to retry after a client disconnect, and how does idempotency affect that answer?
