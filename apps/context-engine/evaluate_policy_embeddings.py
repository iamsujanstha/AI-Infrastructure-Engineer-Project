"""Run the frozen synthetic embedding-component evaluation with prepared local weights only."""
import json
from pathlib import Path
import time

import numpy as np

from policy_compute import load_embedding_model


def evaluate():
    dataset_path = Path(__file__).parents[2] / "docs" / "evaluation" / "policy-embedding-fixtures.json"
    dataset = json.loads(dataset_path.read_text())
    model, profile = load_embedding_model()
    documents = dataset["documents"]
    vectors = list(model.embed([d["text"] for d in documents]))
    rows = []
    for case in dataset["queries"]:
        started = time.monotonic()
        query = next(iter(model.query_embed(case["question"])))
        # The component filter mirrors the required security contract, not a proof of SQL enforcement.
        allowed = [(d, v) for d, v in zip(documents, vectors, strict=True) if d["audience"] in {"all", case["role"]} or case["role"] == "admin"]
        ranked = sorted(allowed, key=lambda pair: -float(np.dot(query, pair[1])))
        ids = [d["id"] for d, _ in ranked[:3]]
        relevant = case["relevant"]
        rr = next((1 / (i + 1) for i, item in enumerate(ids) if item in relevant), 0) if relevant else None
        rows.append({"queryId": case["id"], "returned": ids, "recallAt3": len(set(ids) & set(relevant)) / len(relevant) if relevant else None,
                     "firstRelevantReciprocalRank": rr, "latencyMs": round((time.monotonic() - started) * 1000, 2),
                     "unauthorizedResults": sum(1 for item in ids if next(d for d in documents if d["id"] == item)["audience"] not in {"all",case["role"]} and case["role"] != "admin")})
    judged = [r for r in rows if r["recallAt3"] is not None]
    return {"datasetVersion": dataset["version"], "mode": "embedding_component_only", "embeddingProfile": profile,
            "answerableCases": len(judged), "noRelevantCases": len(rows) - len(judged),
            "meanRecallAt3": sum(r["recallAt3"] for r in judged) / len(judged),
            "MRRAt3": sum(r["firstRelevantReciprocalRank"] for r in judged) / len(judged),
            "unauthorizedResults": sum(r["unauthorizedResults"] for r in rows), "cases": rows,
            "limitations": ["Tiny synthetic corpus, not Atlas or HR acceptance", "Does not exercise SQL, RAG generation, cache, OAuth or UI", "No-answer detection requires the answer layer; nearest neighbors alone do not establish answerability"]}


if __name__ == "__main__":
    report = evaluate()
    print(json.dumps(report, indent=2))
    if report["unauthorizedResults"]:
        raise SystemExit(1)
