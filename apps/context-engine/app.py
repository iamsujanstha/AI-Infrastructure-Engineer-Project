"""Internal computation runtime. Repository processing is introduced in later phases."""
import hmac
import json
import logging
import os
import re
import time
import uuid

from fastapi import FastAPI, HTTPException, Request, Security
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

logger = logging.getLogger("context_engine")
logging.basicConfig(level=logging.INFO, format="%(message)s")
service_bearer = HTTPBearer(auto_error=False, scheme_name="ContextEngineServiceToken")


class HealthResponse(BaseModel):
    status: str = Field(description="Service status")
    service: str = Field(description="Service name")


def create_app(token: str | None = None) -> FastAPI:
    secret = token or os.environ.get("CONTEXT_ENGINE_TOKEN", "")
    if len(secret) < 32:
        raise RuntimeError("CONTEXT_ENGINE_TOKEN must contain at least 32 characters")
    if os.environ.get("NODE_ENV") == "production" and "local-dev-token" in secret:
        raise RuntimeError("Development token forbidden in production")

    app = FastAPI(
        title="Context Engine API",
        summary="Private project-context computation runtime",
        description=(
            "Internal API for the project context engine. The public health route only reports liveness; "
            "the authenticated internal route checks access to this process. Repository scan and retrieval "
            "operations are not exposed as HTTP endpoints yet."
        ),
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )
    from policy_compute import register_policy_routes
    register_policy_routes(app, secret, service_bearer)

    @app.middleware("http")
    async def correlation(request: Request, call_next):
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", incoming) else str(uuid.uuid4())
        traceparent = request.headers.get("traceparent", "")
        valid_trace = re.fullmatch(r"00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}", traceparent)
        started = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:  # noqa: BLE001 - transport boundary must not expose parser or credential details
            response = JSONResponse(status_code=500, content={"detail": "Internal service error"})
        response.headers["x-request-id"] = request_id
        if valid_trace:
            response.headers["traceparent"] = traceparent
        logger.info(json.dumps({
            "operation": "http_request", "request_id": request_id,
            "trace_id": traceparent.split("-")[1] if valid_trace else None,
            "status": response.status_code, "duration_ms": round((time.monotonic() - started) * 1000, 3),
        }))
        return response

    @app.get("/health", response_model=HealthResponse, summary="Check process liveness", tags=["Health"])
    async def liveness() -> HealthResponse:
        return {"status": "ok", "service": "context-engine"}

    @app.get(
        "/internal/health",
        response_model=HealthResponse,
        summary="Check authenticated internal service access",
        description="Requires the NestJS service token in the Authorization bearer scheme.",
        tags=["Health"],
        responses={401: {"description": "Missing or invalid service token"}},
    )
    async def internal_health(
        credentials: HTTPAuthorizationCredentials | None = Security(service_bearer),
    ) -> HealthResponse:
        supplied = credentials.credentials if credentials is not None else ""
        if not hmac.compare_digest(supplied.encode(), secret.encode()):
            raise HTTPException(status_code=401, detail="Invalid service credential")
        return {"status": "ok", "service": "context-engine"}

    return app

