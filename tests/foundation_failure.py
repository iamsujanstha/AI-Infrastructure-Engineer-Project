"""Owned temporary processes/container only; run after API build and uv sync."""
import json
import os
from pathlib import Path
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "apps/context-engine"
TOKEN = "isolated-foundation-test-token-at-least-32-characters"


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def status(url, headers=None):
    try:
        with urlopen(Request(url, headers=headers or {}), timeout=5) as response:
            return response.status
    except HTTPError as error:
        return error.code
    except URLError:
        return 0


def wait_status(url, expected):
    for _ in range(100):
        if status(url) == expected:
            return
        time.sleep(0.1)
    raise AssertionError((url, expected, status(url)))


def stop(process):
    if process:
        process.terminate()
        process.wait(timeout=10)


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def main():
    engine = api = stalled = None
    name = f"context-foundation-test-{os.getpid()}"
    engine_port, api_port, pg_port = free_port(), free_port(), free_port()
    engine_url = f"http://127.0.0.1:{engine_port}"
    api_url = f"http://127.0.0.1:{api_port}"
    env = {**os.environ, "NODE_ENV": "test", "CONTEXT_ENGINE_TOKEN": TOKEN,
           "CONTEXT_ENGINE_URL": engine_url, "CONTEXT_ENGINE_TIMEOUT_MS": "300",
           "API_PORT": str(api_port), "API_HOST": "127.0.0.1"}
    def start_engine():
        return subprocess.Popen([str(ENGINE / ".venv/bin/python"), "-m", "uvicorn",
                                 "app:create_app", "--factory", "--host", "127.0.0.1",
                                 "--port", str(engine_port), "--no-access-log"],
                                cwd=ENGINE, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        docker("run", "-d", "--name", name, "-e", "POSTGRES_PASSWORD=fixture-only",
               "-p", f"127.0.0.1:{pg_port}:5432", "pgvector/pgvector:pg17")
        env["DATABASE_URL"] = f"postgresql://postgres:fixture-only@127.0.0.1:{pg_port}/postgres"
        engine = start_engine()
        wait_status(engine_url + "/health", 200)
        assert status(engine_url + "/internal/health") == 401
        assert status(engine_url + "/internal/health", {"Authorization": f"Bearer {TOKEN}"}) == 200
        api = subprocess.Popen(["node", "apps/api/dist/main.js"], cwd=ROOT, env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        wait_status(api_url + "/health/context-engine", 200)
        wait_status(api_url + "/health/database", 200)
        stop(engine)
        engine = None
        wait_status(api_url + "/health/context-engine", 503)
        assert status(api_url + "/health") == 200
        engine = start_engine()
        wait_status(api_url + "/health/context-engine", 200)
        stop(engine)
        engine = None
        class SlowHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                time.sleep(1)
            def log_message(self, *_args):
                pass
        stalled = ThreadingHTTPServer(("127.0.0.1", engine_port), SlowHandler)
        threading.Thread(target=stalled.serve_forever, daemon=True).start()
        started = time.monotonic()
        assert status(api_url + "/health/context-engine") == 504
        assert time.monotonic() - started < 2
        stalled.shutdown()
        stalled.server_close()
        stalled = None
        engine = start_engine()
        wait_status(api_url + "/health/context-engine", 200)
        docker("stop", name)
        wait_status(api_url + "/health/database", 503)
        assert status(api_url + "/health") == 200
        docker("start", name)
        wait_status(api_url + "/health/database", 200)
        assert docker("exec", name, "psql", "-U", "postgres", "-tAc",
                      "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname FROM pg_extension WHERE extname='vector';").endswith("vector")
        print(json.dumps({"engine_auth": "passed", "engine_stop_recover": "passed",
                          "engine_timeout_504": "passed", "postgres_stop_recover": "passed",
                          "pgvector": "passed", "liveness_during_outage": "passed"}))
    finally:
        if stalled:
            stalled.shutdown()
            stalled.server_close()
        stop(engine)
        stop(api)
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()

