"""Process boundary around native grammar parsing and untrusted file bytes."""
import multiprocessing
import time
from multiprocessing.connection import Connection

from analyzers import analyze_source

MAX_FILES_PER_WORKER = 12
PARSE_DEADLINE_SECONDS = 2.0


def _worker_loop(connection: Connection):
    try:
        while True:
            request = connection.recv()
            if request is None:
                return
            path, source_id, raw = request
            try:
                result = analyze_source(path, source_id, raw)
            except (OSError, ValueError, TypeError, IndexError, AttributeError, RuntimeError, OverflowError):
                result = {"status": "failed", "reason": "analyzer_internal_error", "duration_ms": 0.0, "facts": []}
            connection.send(result)
    finally:
        connection.close()


class AnalyzerRunner:
    """Runs parsers in a bounded worker and recycles native state between batches."""

    def __init__(self, deadline_seconds=PARSE_DEADLINE_SECONDS):
        if deadline_seconds <= 0:
            raise ValueError("deadline_must_be_positive")
        self._context = multiprocessing.get_context("spawn")
        self._deadline_seconds = deadline_seconds
        self._connection: Connection | None = None
        self._process: multiprocessing.Process | None = None
        self._requests = 0

    def _stop(self):
        connection, process = self._connection, self._process
        self._connection = None
        self._process = None
        if connection is not None:
            try:
                connection.send(None)
            except (BrokenPipeError, EOFError, OSError):
                pass
            connection.close()
        if process is not None:
            process.join(timeout=0.25)
            if process.is_alive():
                process.terminate()
                process.join(timeout=1)
        self._requests = 0

    def _start(self):
        parent, child = self._context.Pipe(duplex=True)
        process = self._context.Process(target=_worker_loop, args=(child,), daemon=True)
        process.start()
        child.close()
        self._connection = parent
        self._process = process
        self._requests = 0

    def analyze(self, path, source_id, raw):
        if (self._process is None or self._connection is None or not self._process.is_alive()
                or self._requests >= MAX_FILES_PER_WORKER):
            self._stop()
            self._start()
        connection = self._connection
        process = self._process
        started = time.monotonic()
        try:
            connection.send((path, source_id, raw))
            if not connection.poll(self._deadline_seconds):
                process.terminate()
                process.join(timeout=1)
                connection.close()
                self._connection = None
                self._process = None
                self._requests = 0
                return {"status": "failed", "reason": "analyzer_timeout", "duration_ms": round((time.monotonic() - started) * 1000, 3), "facts": []}
            result = connection.recv()
            self._requests += 1
            if not isinstance(result, dict) or not isinstance(result.get("facts"), list):
                raise TypeError("invalid_worker_result")
            return result
        except (EOFError, OSError, ValueError, TypeError):
            if process.is_alive():
                process.terminate()
            process.join(timeout=1)
            connection.close()
            exit_code = process.exitcode
            self._connection = None
            self._process = None
            self._requests = 0
            reason = "analyzer_worker_crashed" if exit_code is not None else "analyzer_worker_failed"
            return {"status": "failed", "reason": reason,
                    "duration_ms": round((time.monotonic() - started) * 1000, 3), "facts": []}

    def close(self):
        self._stop()
