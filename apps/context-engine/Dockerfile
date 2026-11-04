FROM ghcr.io/astral-sh/uv:0.9.7 AS uv
FROM python:3.12-slim AS builder
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev \
    && CFLAGS="-O1" uv sync --frozen --no-dev \
    && rm -rf /var/lib/apt/lists/*

FROM python:3.12-slim AS runtime
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY app.py scanner.py analyzers.py analysis_worker.py graph.py local_cli.py storage.py ./
RUN useradd --uid 10001 --create-home engine
USER engine
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]

