"""Conversion of protocol PDF content into the shared graph contract."""

from __future__ import annotations

from pydantic import ValidationError

from ..contracts import GraphPayload, PageText
from .consistency import check
from .gemini_client import GeminiClient, LLMClient, build_prompt
from .pdf_reader import extract_pages
from .schema import ExtractedGraph, ExtractionError, ExtractionResult

MAX_ATTEMPTS = 2


def extract_analysis(
    pdf_bytes: bytes, client: LLMClient | None = None
) -> ExtractionResult:
    """Extract, validate, and consistency-check a graph from a text-based PDF."""
    try:
        pages = extract_pages(pdf_bytes)
    except ValueError as exc:
        raise ExtractionError(str(exc)) from exc
    raw, payload = _generate_valid_payload(pages, client or GeminiClient())
    graph, issues = check(payload, pages)
    return ExtractionResult(graph=graph, raw_json=raw, issues=issues)


def _generate_valid_payload(
    pages: list[PageText], client: LLMClient
) -> tuple[str, GraphPayload]:
    feedback = None
    for _ in range(MAX_ATTEMPTS):
        raw = client.generate(build_prompt(pages, feedback))
        try:
            data = ExtractedGraph.model_validate_json(raw).model_dump(
                mode="json", exclude_none=True
            )
            return raw, GraphPayload.model_validate(data)
        except ValidationError as exc:
            feedback = str(exc)
    raise ExtractionError(
        f"Gemini output failed validation after {MAX_ATTEMPTS} attempts"
    )
