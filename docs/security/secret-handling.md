# Secret handling

Default-deny .env and credential/private-key/certificate artifacts, generated dependencies, VCS internals and sensitive config paths. Match known formats, configurable patterns and entropy signals on eligible text; use path screening too. Exclusions run before persistence; eligible bytes pass sanitization before chunking, embedding, logging or API response construction.

Keep raw source only transiently inside the bounded scanner process. Persist sanitized text/hash and minimal findings (rule ID, category, severity, approved path/range), never matching secret values or raw evidence snippets. Replace inline secret spans with a fixed marker while preserving line layout; if reliable sanitization cannot be established, exclude the file. Re-run analysis when redaction rules change; old chunks/vectors must be retired, not reused by file hash alone.

Canary tests must inspect manifest, artifact, graph, chunks, embedding inputs, retrieved context, compiler output, errors and logs. Local developer input is still untrusted. Detection cannot guarantee coverage for all encodings or unknown credential formats; document residual risk and provide configurable exclusions. Define data retention, customer deletion and permitted diagnostic access before production ingestion.

