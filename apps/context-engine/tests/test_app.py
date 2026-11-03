import pytest
from fastapi.testclient import TestClient

from app import create_app

TOKEN = "test-service-token-with-at-least-32-characters"


def test_authentication_and_correlation():
    client = TestClient(create_app(TOKEN))
    assert client.get("/health").status_code == 200
    assert client.get("/internal/health").status_code == 401
    assert client.get("/internal/health", headers={"authorization": "Bearer wrong"}).status_code == 401
    trace = "00-" + "1" * 32 + "-" + "2" * 16 + "-01"
    response = client.get("/internal/health", headers={
        "authorization": f"Bearer {TOKEN}", "x-request-id": "foundation-test", "traceparent": trace,
    })
    assert response.status_code == 200
    assert response.headers["x-request-id"] == "foundation-test"
    assert response.headers["traceparent"] == trace


def test_unsafe_configuration_and_request_id():
    with pytest.raises(RuntimeError):
        create_app("short")
    response = TestClient(create_app(TOKEN)).get("/health", headers={"x-request-id": "bad value"})
    assert response.headers["x-request-id"] != "bad value"

