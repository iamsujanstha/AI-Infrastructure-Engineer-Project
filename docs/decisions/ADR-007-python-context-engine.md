# FastAPI and shared Python analysis core

- Status: Proposed for implementation; product scope and service split follow the 2026-11-03 brief.
- Date: 2026-11-03

## Problem

Context analysis and future embedding/reranking/evaluation need a cohesive Python computation boundary.

## Constraints

Two backend runtimes maximum initially; no repository execution; CLI must reuse analyzer behavior.

## Failure modes

Unbounded parsing, malformed artifacts and unavailable engine must not hang Nest or leak secrets.

## Options

All computation in Nest; independent CLI/HTTP analyzers; many parser/embedding services.

## Tradeoffs

Python ML ecosystem and one analyzer implementation; costs are an extra runtime, typed HTTP contracts and explicit resource limits.

## Decision

Use FastAPI around a reusable Python core; propose uv/Python 3.12 and tree-sitter AST adapters for Phase 1/3 validation. CLI local runner invokes this core through versioned JSON, without duplicating analyzers in TypeScript.

## Implementation

Independently locked Python project in apps/context-engine; authenticated internal HTTP, deadline propagation, bounded subprocess parsing; no model/provider runtime dependency.

## Verification

Unavailable service yields 503/504; parser hostile-input fixtures, CLI/HTTP artifact equivalence and request/trace propagation.

## Scaling and security

Bound admission and per-project work; measure parser/embedding CPU, database queries and HTTP latency before extraction or broker adoption. Use non-owner database roles, explicit authorization scopes and sanitized telemetry. No runtime or load result is claimed by this ADR.

## Interview question

Which syntax facts can an AST establish, and which runtime relationships remain uncertain?

