"""Private PDF/embedding computation. Model files are fetched only by the explicit preparation command."""
import base64
import hashlib
import hmac
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import uuid

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
MODEL = "BAAI/bge-small-en-v1.5"
CACHE = os.environ.get("POLICY_EMBEDDING_CACHE", str(Path(__file__).parent / ".cache" / "policy-embeddings"))
_model = None
_profile = None
_gate = threading.Lock()


def load_embedding_model(download=False):
    global _model, _profile
    if _model is None:
        import onnxruntime
        onnxruntime.disable_telemetry_events()
        from fastembed import TextEmbedding
        os.environ["HF_HUB_OFFLINE"] = "0" if download else "1"
        try:
            _model = TextEmbedding(model_name=MODEL, cache_dir=CACHE, threads=2, providers=["CPUExecutionProvider"], local_files_only=not download)
        except Exception:
            raise RuntimeError("policy_embedding_model_unavailable") from None
        directory = Path(_model.model._model_dir)
        digest = hashlib.sha256()
        # Pin the effective model/tokenizer files, not just dimensions or a mutable model label.
        for file in sorted(directory.rglob("*")):
            if file.is_file() and file.suffix in {".onnx", ".json", ".txt"}:
                digest.update(str(file.relative_to(directory)).encode())
                with file.open("rb") as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        digest.update(chunk)
        _profile = f"bge-small-en-v1.5:384:fastembed-{importlib.metadata.version('fastembed')}:{digest.hexdigest()[:24]}"
    return _model, _profile


def compute(kind, payload):
    if not _gate.acquire(blocking=False):
        raise RuntimeError("policy_compute_busy")
    try:
        if kind == "pdf_index":
            data = base64.b64decode(payload["pdfBase64"], validate=True)
            result = subprocess.run([sys.executable, str(Path(__file__).with_name("policy_pdf_worker.py"))],
                                    input=data, capture_output=True, timeout=12, check=False)
            if len(result.stdout) > 1500000:
                raise ValueError("pdf_output_limit")
            extracted = json.loads(result.stdout)
            if extracted.get("error") == "pdf_memory_limit_unavailable":
                raise RuntimeError("pdf_extraction_requires_memory_limited_container")
            if result.returncode or "error" in extracted:
                raise ValueError(extracted.get("error", "pdf_extraction_failed"))
            model, profile = load_embedding_model()
            vectors = list(model.embed([p["text"] for p in extracted["passages"]], batch_size=16))
            return {**extracted, "profile": profile, "passages": [dict(p, embedding=v.tolist()) for p, v in zip(extracted["passages"], vectors, strict=True)]}
        question = payload.get("question", "")
        if not isinstance(question, str) or not 1 <= len(question) <= 1000:
            raise ValueError("invalid_question")
        model, profile = load_embedding_model()
        vector = next(iter(model.query_embed(question))).tolist()
        return {"profile": profile, "vector": vector}
    finally:
        _gate.release()


def validate_scope(token, payload, signature):
    scope = payload.get("scope", {})
    for name in ("organizationId", "userId"):
        uuid.UUID(scope[name])
    if scope.get("operation") not in {"pdf_index", "embed_query"}:
        raise ValueError("invalid_scope")
    if abs(time.time() - scope["issuedAt"]) > 60:
        raise ValueError("expired_scope")
    # Sign exact request bytes in Node/Python; scope is not supplied by the browser.
    expected = hmac.new(token.encode(), payload["_raw"], hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise ValueError("invalid_scope_signature")


def register_policy_routes(app, secret, bearer):
    from fastapi import HTTPException, Request, Security
    from starlette.concurrency import run_in_threadpool

    @app.post("/internal/policy/compute", tags=["Policy computation"])
    async def policy_compute(request: Request, credentials=Security(bearer)):
        supplied = credentials.credentials if credentials else ""
        if not hmac.compare_digest(supplied.encode(), secret.encode()):
            raise HTTPException(401, "Invalid service credential")
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 8 * 1024 * 1024:
                raise HTTPException(413, "Policy computation request too large")
        try:
            payload = json.loads(data)
            payload["_raw"] = bytes(data)
            validate_scope(secret, payload, request.headers.get("x-policy-signature", ""))
        except (ValueError, KeyError, TypeError):
            raise HTTPException(401, "Invalid or expired authorized computation scope") from None
        try:
            return await run_in_threadpool(compute, payload["scope"]["operation"], payload)
        except ValueError as error:
            known = {"invalid_pdf", "encrypted_pdf_unsupported", "pdf_page_limit", "active_or_embedded_pdf_unsupported", "pdf_text_limit", "possible_credentials_in_pdf", "hidden_pdf_controls", "pdf_passage_limit", "no_extractable_text_ocr_required", "invalid_question"}
            reason = str(error) if str(error) in known else "pdf_or_embedding_input_unsupported"
            raise HTTPException(422, reason) from None
        except RuntimeError as error:
            raise HTTPException(429 if str(error) == "policy_compute_busy" else 503, "Policy computation busy or model unavailable") from None
        except Exception:
            raise HTTPException(503, "Policy extraction or local embedding dependency unavailable") from None


if __name__ == "__main__" and sys.argv[1:] == ["--download-model"]:
    _, profile = load_embedding_model(download=True)
    print(json.dumps({"embeddingProfile": profile, "cachePrepared": True}))
