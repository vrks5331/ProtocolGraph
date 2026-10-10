"""Conversion of protocol PDF content into the shared graph contract."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from pydantic import ValidationError

from ..contracts import GraphPayload, PageText
from ..graph_engine import build_graph, graph_json
from ..rules import validate
from .consistency import check, shift_negative_days
from .gemini_client import GeminiClient, LLMClient, build_prompt
from .pdf_reader import extract_pages
from .schema import ConsistencyIssue, ExtractedGraph, ExtractionError, StorageRecord

MAX_ATTEMPTS = 2


def extract_graph(pdf_bytes: bytes, client: LLMClient | None = None) -> GraphPayload:
    """Extract and validate a graph from a text-based protocol PDF."""
    _, payload, _ = _extract(pdf_bytes, client)
    return payload


def extract_analysis(
    pdf_bytes: bytes, filename: str, client: LLMClient | None = None
) -> StorageRecord:
    """Run the full pipeline and serialize every JSON column for storage."""
    raw, payload, issues = _extract(pdf_bytes, client)
    graph = build_graph(payload)
    return StorageRecord(
        pdf_filename=filename,
        created_at=datetime.now(timezone.utc),
        ext_json=raw,
        graph_json=json.dumps(graph_json(graph)),
        findings_json=json.dumps(validate(graph)),
        issues_json=json.dumps([issue.model_dump() for issue in issues]),
    )


def _extract(
    pdf_bytes: bytes, client: LLMClient | None
) -> tuple[str, GraphPayload, list[ConsistencyIssue]]:
    try:
        pages = extract_pages(pdf_bytes)
    except ValueError as exc:
        raise ExtractionError(str(exc)) from exc
    raw, payload, day_issues = _generate_valid_payload(pages, client or GeminiClient())
    clean, issues = check(payload, pages)
    return raw, clean, day_issues + issues


def _generate_valid_payload(
    pages: list[PageText], client: LLMClient
) -> tuple[str, GraphPayload, list[ConsistencyIssue]]:
    feedback = None
    for _ in range(MAX_ATTEMPTS):
        raw = client.generate(build_prompt(pages, feedback))
        try:
            data = ExtractedGraph.model_validate_json(raw).model_dump(
                mode="json", exclude_none=True
            )
            day_issues = shift_negative_days(data)
            return raw, GraphPayload.model_validate(data), day_issues
        except ValidationError as exc:
            feedback = str(exc)
    raise ExtractionError(
        f"Gemini output failed validation after {MAX_ATTEMPTS} attempts: {feedback}"
    )
