# Retrieval evaluation

Build versioned judgments for authentication, products, orders, payments and architecture from reviewed Atlas source files. A question includes expected source versions/ranges, relevance labels, permitted scope, repository revision and dataset version. Missing judgments are reported, not treated as proof of relevance. Synthetic fixtures test mechanics; they cannot establish Atlas acceptance.

For each query and fixed K: Recall@K is retrieved relevant sources divided by all judged relevant sources; Precision@K is relevant returned sources divided by returned sources up to K (also report returned count); MRR is mean reciprocal rank of the first relevant result; irrelevant rate uses reviewed irrelevant results divided by reviewed returned results. Define empty/no-relevant cases explicitly as not applicable and report their count. Measure end-to-end and channel latency distributions from actual executions, with corpus/model/index versions, hardware and warm/cold conditions.

Compare structured/lexical baselines with semantic, graph and hybrid variants on the same frozen corpus. Keep tuning and held-out queries separate. CLI context evaluate reports both quality and security denials. Zero unauthorized results is a hard gate independent of relevance. Numeric acceptance targets are agreed against the real Atlas corpus before Phase 9; no invented score or production-looking sample metrics.

