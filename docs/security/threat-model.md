# Project-context threat model

Status: proposed controls, not implemented security certification. Assets: repository content, source names, architecture facts, embeddings, credentials, membership/policies, scan artifacts and audit metadata. Adversaries include a malicious repository, a compromised integration credential, an unauthorized tenant member and an untrusted client. A compromised platform service remains a trust-boundary breach requiring credential rotation and incident handling.

~~~mermaid
flowchart LR
    Repo[Untrusted repository] --> Gate[Root confinement limits and secret sanitization]
    Gate --> Artifact[Approved sanitized artifact]
    Caller[Untrusted client] --> Nest[Authentication authorization and quotas]
    Artifact --> Nest
    Nest --> Permit[Signed scoped operation permit]
    Permit --> Engine[Internal authenticated engine]
    Engine --> DB[Scoped database roles RLS and query predicates]
~~~

| Threat | Required control and verification |
| --- | --- |
| Cross-project/tenant/environment leakage | Mandatory scope in contracts, composite FKs, query filters and RLS; adversarial two-tenant/two-project tests plus same-project source-ACL tests |
| Arbitrary file access/path traversal | Explicit approved root, no symlinks V1, reject absolute/parent paths and special files; test symlink races and malicious filenames |
| Secret leakage | Exclude credential files; sanitize before artifacts/storage/chunks/embeddings; no raw finding evidence; canary fixtures across every output and log sink |
| Parser/resource attack | Bounded bytes/files/time/memory/depth, isolated parser execution, no code/config evaluation or external OpenAPI refs |
| Prompt injection | Treat comments/docs as untrusted quoted data, preserve provenance; no tool/role instructions interpreted from repository text |
| Unauthenticated internal service | Private network plus service credentials and signed audience/operation-bound permits; expiry/replay validation |
| Index poisoning/race | Manifest/config digests, publication fencing, immutable generations and atomic pointer swap; crash/concurrency tests |
| Query/telemetry leakage | No content/credentials in default logs or metric labels; explicit retention and separately authorized query diagnostics |

The scanner has no need for production database credentials. PostgreSQL/MongoDB analyzers inspect repository schemas, not customer records. Secret detection is probabilistic defense, never proof that arbitrary content is safe; suspicious or unsupported content is excluded/quarantined by default. Finding locations and paths may themselves be sensitive and require authorization.

Phase 1 must define the concrete user/integration authentication mechanism and revocation behavior before exposing project operations. Service authentication in Python verifies the Nest-issued capability, not customer business RBAC. Security failure never falls back to unscoped search or a cached result from another scope.

