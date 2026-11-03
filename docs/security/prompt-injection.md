# Repository prompt injection

Source comments, README text, documentation and analyzer outputs are data. They cannot set platform instructions, grant tool permissions, supply credentials, select arbitrary network endpoints or change security scope.

Quote source sections with explicit untrusted-content labels and provenance in compiled context. Compile deterministically without an LLM in V1. Do not execute instructions or code from analyzed files. Sanitize control characters and bound output while preserving valid source ranges. Future consuming agents must independently constrain tools and treat these sections as untrusted; delimiters alone do not make prompt injection harmless.

Fixtures should include hostile README instructions, forged role/tool messages, secret-exfiltration requests and misleading comments. Verify they remain inert data, cannot alter retrieval authorization and are never executed. Security is enforced by code/permissions, not by asking a downstream model to ignore malicious text.

