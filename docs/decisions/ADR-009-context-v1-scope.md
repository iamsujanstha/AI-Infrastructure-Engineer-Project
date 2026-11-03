# Context-only V1 and dependency discipline

- Status: Proposed for implementation; product scope and service split follow the 2026-11-03 brief.
- Date: 2026-11-03

## Problem

The product must understand and securely retrieve project context before agent integration.

## Constraints

Atlas is first real target; new implementation order is Phase 0–10; existing web/Redis/conversation work is present.

## Failure modes

Early generative integration hides retrieval defects; toy demos can falsely claim customer readiness.

## Options

Continue inference/lab-first roadmap; install every proposed package/service upfront.

## Tradeoffs

Smaller verifiable product with lower operating cost; user-facing agent behavior arrives later.

## Decision

V1 ends at evaluated, cited, permission-aware compiled project context. Hermes/MLX/Qwen are deferred until Phase 10. Keep npm workspaces, introduce uv only for Python, and add Redis only for demonstrated workload need. Web remains later work.

## Implementation

Build scanner/analyzers/graph/storage/retrieval/compiler/evaluation in brief order; validate Atlas only on approved real checkout/revision.

## Verification

Frozen real-source judgments, measured quality/latency, isolation and secret tests; no fabricated metrics.

## Scaling and security

Bound admission and per-project work; measure parser/embedding CPU, database queries and HTTP latency before extraction or broker adoption. Use non-owner database roles, explicit authorization scopes and sanitized telemetry. No runtime or load result is claimed by this ADR.

## Interview question

How do you prove retrieval quality independently of an LLM's answer?

