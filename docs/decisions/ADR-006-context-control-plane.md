# NestJS control and integration plane

- Status: Proposed for implementation; product scope and service split follow the 2026-11-03 brief.
- Date: 2026-11-03

## Problem

Customer identity, project authorization, API integration and audit need one enforceable boundary.

## Constraints

Existing NestJS foundation; no trusted project principal or tenant service yet.

## Failure modes

Keeping policy in Python duplicates business authorization; letting clients provide scope creates impersonation and confused-deputy paths.

## Options

Python-owned RBAC; client-generated scope; a single Python service.

## Tradeoffs

One policy owner and reusable TypeScript integration, at the cost of maintaining explicit internal contracts.

## Decision

Use Nest for identity/organizations/projects/policies/public APIs/orchestration; issue short-lived signed operation permits to Python. Keep existing /api/v1 prefix and raw pg control repositories.

## Implementation

Add identity adapters, permit signing/rotation, narrow ContextEngineClient and schema validation during Phase 1 before shared project endpoints.

## Verification

Unauthorized, forged/expired permit, engine timeout and cross-project tests; audit records without source text.

## Scaling and security

Bound admission and per-project work; measure parser/embedding CPU, database queries and HTTP latency before extraction or broker adoption. Use non-owner database roles, explicit authorization scopes and sanitized telemetry. No runtime or load result is claimed by this ADR.

## Interview question

How do you prevent an authenticated engine from becoming a confused deputy?

