FROM ghcr.io/astral-sh/uv:0.9.7 AS uv
FROM python:3.12-slim
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY app.py scanner.py local_cli.py ./
RUN useradd --uid 10001 --create-home engine
USER engine
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]

