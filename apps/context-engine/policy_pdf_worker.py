"""Bounded untrusted PDF text extraction. Protocol output contains private text; never log it."""
import io
import json
import resource
import sys

from pypdf import PdfReader
from scanner import findings

MAX_PDF_BYTES = 5 * 1024 * 1024


def extract_pdf(data: bytes) -> dict:
    if not data.startswith(b"%PDF-") or len(data) > MAX_PDF_BYTES:
        raise ValueError("invalid_pdf")
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted:
        raise ValueError("encrypted_pdf_unsupported")
    if not 1 <= len(reader.pages) <= 100:
        raise ValueError("pdf_page_limit")
    root = reader.trailer["/Root"]
    if any(key in root for key in ("/OpenAction", "/AA", "/AcroForm")) or "/EmbeddedFiles" in root.get("/Names", {}):
        raise ValueError("active_or_embedded_pdf_unsupported")
    passages = []
    total_chars = 0
    for page_index, page in enumerate(reader.pages, 1):
        if "/AA" in page:
            raise ValueError("active_pdf_unsupported")
        text = (page.extract_text() or "").replace("\r\n", "\n").replace("\r", "\n")
        total_chars += len(text)
        if total_chars > 160000:
            raise ValueError("pdf_text_limit")
        if findings(text):
            raise ValueError("possible_credentials_in_pdf")
        if any((ord(c) < 32 and c not in "\n\t") or 0x202A <= ord(c) <= 0x202E or 0x2066 <= ord(c) <= 0x2069 for c in text):
            raise ValueError("hidden_pdf_controls")
        # Lines are extraction lines on this page, not coordinates or claims of layout fidelity.
        group = []
        start = 1

        def flush(end):
            nonlocal group
            if group:
                passages.append({"ordinal": len(passages) + 1, "pageNumber": page_index,
                                 "lineStart": start, "lineEnd": end, "text": "\n".join(group)})
                group = []

        for line_index, line in enumerate(text.splitlines(), 1):
            if not line.strip():
                flush(line_index - 1)
                continue
            # Split unusually long extraction lines without discarding text; ranges may share a line.
            for offset in range(0, len(line), 1000):
                piece = line[offset:offset + 1000]
                if sum(len(x) + 1 for x in group) + len(piece) > 1000:
                    flush(line_index if offset else line_index - 1)
                if not group:
                    start = line_index
                group.append(piece)
        flush(len(text.splitlines()))
        if len(passages) > 200:
            raise ValueError("pdf_passage_limit")
    if not passages:
        raise ValueError("no_extractable_text_ocr_required")
    return {"pageCount": len(reader.pages), "passages": passages}


if __name__ == "__main__":
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
        limit = resource.RLIMIT_AS if sys.platform.startswith("linux") else resource.RLIMIT_DATA
        try:
            resource.setrlimit(limit, (512 * 1024 * 1024, 512 * 1024 * 1024))
        except (OSError, ValueError):
            print(json.dumps({"error": "pdf_memory_limit_unavailable"}))
            sys.exit(3)
        payload = sys.stdin.buffer.read(MAX_PDF_BYTES + 1)
        print(json.dumps(extract_pdf(payload), ensure_ascii=False))
    except Exception as error:
        # Only bounded known failure codes cross the parser boundary, not exception text or source.
        reason = str(error) if isinstance(error, ValueError) and str(error) in {
            "invalid_pdf", "encrypted_pdf_unsupported", "pdf_page_limit", "active_or_embedded_pdf_unsupported",
            "active_pdf_unsupported", "pdf_text_limit", "possible_credentials_in_pdf", "hidden_pdf_controls",
            "pdf_passage_limit", "no_extractable_text_ocr_required",
        } else "pdf_extraction_failed"
        print(json.dumps({"error": reason}))
        sys.exit(2)
