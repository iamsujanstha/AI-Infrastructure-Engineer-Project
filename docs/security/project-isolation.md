# Project isolation

Tenant identity is the organization ID. Every context operation requires tenant, user/integration principal, project, environment, permissions and permitted source labels resolved by Nest. No search(query) overload exists.

~~~mermaid
flowchart TD
    A[Atlas principal] --> Policy[Nest scope resolution]
    Policy --> Atlas[Atlas permitted environment and source labels]
    Atlas --> Query[Scope predicates and RLS]
    Query --> Rows[Atlas authorized generation only]
    Other[School project rows] -. denied .-> Query
~~~

Persist scope on all context rows and FK endpoints; perform SET LOCAL tenant/project context in the same checked-out transaction as queries. Use non-owner roles without BYPASSRLS and FORCE ROW LEVEL SECURITY where appropriate. Connection-pool reuse must not preserve prior request scope. Test row access under actual runtime roles, not the migration owner.

Source restrictions apply within a project, not only between projects. Include permitted labels in exact/lexical/vector/graph queries and provenance expansion. Cache identities, if introduced later, include scope, policy version and generation. No cross-project retrieval by default, including counts, snippets, security findings, node names and graph neighbors.

