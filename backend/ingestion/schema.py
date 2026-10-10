"""Ingestion-only models: the Gemini response schema and the storage record."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from ..contracts import EdgeType, NodeType

# The only (source type, target type) pair each edge type may connect.
EDGE_SIGNATURES: dict[str, tuple[str, str]] = {
    EdgeType.SUPPORTS.value: (NodeType.OBJECTIVE.value, NodeType.ENDPOINT.value),
    EdgeType.MEASURED_BY.value: (NodeType.ENDPOINT.value, NodeType.PROCEDURE.value),
    EdgeType.SCHEDULED_AT.value: (NodeType.PROCEDURE.value, NodeType.VISIT.value),
    EdgeType.ANALYZED_BY.value: (NodeType.ENDPOINT.value, NodeType.ANALYSIS.value),
    EdgeType.REQUIRES_AT.value: (NodeType.ELIGIBILITY.value, NodeType.VISIT.value),
}


class ExtractionError(Exception):
    """Raised when a PDF cannot be turned into a usable graph."""


class ExtractedNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: NodeType
    label: str
    description: str | None = None
    page: int
    source_text: str
    confidence: float | None = None
    field: str | None = None
    value: str | int | float | None = None
    required_day: int | None = None
    day: int | None = None
    window_before_days: int | None = None
    window_after_days: int | None = None


class ExtractedEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str
    target: str
    type: EdgeType
    confidence: float | None = None
    required: bool | None = None
    condition_text: str | None = None
    arm_ids: list[str] | None = None
    pop_ids: list[str] | None = None


class ExtractedGraph(BaseModel):
    """Schema Gemini must follow; stricter than GraphPayload."""

    model_config = ConfigDict(extra="forbid")

    nodes: list[ExtractedNode]
    edges: list[ExtractedEdge]


IssueAction = Literal[
    "dropped_node",
    "dropped_edge",
    "merged_edge",
    "stripped_field",
    "corrected_page",
    "fuzzy_match",
    "adjusted_day",
]


class ConsistencyIssue(BaseModel):
    rule: str
    action: IssueAction
    item_id: str
    message: str


class StorageRecord(BaseModel):
    """One analysis, with every JSON column already serialized for SQLite."""

    pdf_filename: str
    created_at: datetime
    ext_json: str
    graph_json: str
    findings_json: str
    issues_json: str
