import hashlib
import hmac
import io
import json
import os
import time
import uuid

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from app import create_app
from policy_pdf_worker import extract_pdf
import policy_compute

TOKEN = "synthetic-policy-service-token-at-least-32-chars"


def pdf_fixture(text="Synthetic policy: annual leave is twelve days.", encrypted=False):
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
    stream = DecodedStreamObject()
    stream.set_data(f"BT /F1 12 Tf 50 700 Td ({text}) Tj ET".encode("ascii"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    if encrypted:
        writer.encrypt("synthetic-only")
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def test_pdf_pages_and_exact_text():
    result = extract_pdf(pdf_fixture())
    assert result["pageCount"] == 1
    assert result["passages"][0]["pageNumber"] == 1
    assert result["passages"][0]["text"] == "Synthetic policy: annual leave is twelve days."


@pytest.mark.parametrize("payload", [b"not a pdf", pdf_fixture(encrypted=True), pdf_fixture("password=synthetic-test-secret")])
def test_rejected_pdfs(payload):
    with pytest.raises(ValueError):
        extract_pdf(payload)


def test_image_only_pdf_requires_ocr():
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    output = io.BytesIO()
    writer.write(output)
    with pytest.raises(ValueError, match="ocr_required"):
        extract_pdf(output.getvalue())


def test_service_scope_is_signed_expiring_and_checked_before_computation(monkeypatch):
    called = []
    monkeypatch.setattr(policy_compute, "compute", lambda kind, payload: called.append(kind) or {"profile": "fixture", "vector": [1]})
    client = TestClient(create_app(TOKEN))
    payload = {"question": "synthetic policy", "scope": {"organizationId": str(uuid.uuid4()), "userId": str(uuid.uuid4()), "operation": "embed_query", "issuedAt": int(time.time())}}

    def send(body, signature=None, auth=True):
        raw = json.dumps(body).encode()
        return client.post("/internal/policy/compute", content=raw, headers={
            "authorization": f"Bearer {TOKEN if auth else 'wrong'}", "content-type": "application/json",
            "x-policy-signature": signature or hmac.new(TOKEN.encode(), raw, hashlib.sha256).hexdigest(),
        })

    assert send(payload, auth=False).status_code == 401
    assert send(payload, signature="forged").status_code == 401
    assert send({**payload, "scope": {**payload["scope"], "issuedAt": 1}}).status_code == 401
    assert called == []
    assert send(payload).status_code == 200
    assert called == ["embed_query"]


@pytest.mark.skipif(os.environ.get("RUN_POLICY_EMBEDDING_TEST") != "1", reason="requires prepared local model")
def test_real_local_embeddings_are_normalized_versioned_and_semantic():
    model, profile = policy_compute.load_embedding_model()
    documents = ["Employees may request paid annual vacation.", "The database password rotation runbook."]
    import numpy as np
    vectors = list(model.embed(documents))
    query = next(iter(model.query_embed("How can staff take time off work?")))
    assert len(query) == 384 and abs(float(np.linalg.norm(query)) - 1) < 0.02
    assert float(np.dot(query, vectors[0])) > float(np.dot(query, vectors[1]))
    assert "fastembed-" in profile and profile == policy_compute.load_embedding_model()[1]
