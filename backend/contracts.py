from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    field_validator,
    model_validator,
)


class NodeType(str, Enum):
    OBJECTIVE = "objective"
    ENDPOINT = "endpoint"
    PROCEDURE = "procedure"
    VISIT = "visit"
    ELIGIBILITY = "eligibility"
    ANALYSIS = "analysis"


class EdgeType(str, Enum):
    SUPPORTS = "SUPPORTS"
    MEASURED_BY = "MEASURED_BY"
    SCHEDULED_AT = "SCHEDULED_AT"
    ANALYZED_BY = "ANALYZED_BY"
    REQUIRES_AT = "REQUIRES_AT"


class Node(BaseModel):
    """A protocol concept and the source evidence used to extract it."""

    model_config = ConfigDict(extra="allow", use_enum_values=True)

    id: str = Field(min_length=1)
    type: NodeType
    label: str | None = None
    description: str | None = None
    page: int | None = Field(default=None, ge=1)
    source_text: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)

    # Type-specific properties used by the current rules and simulator.
    field: str | None = None
    value: Any | None = None
    required_day: int | None = Field(default=None, ge=0)
    # Study day relative to Day 1; pre-treatment visits such as screening are negative.
    day: int | None = None
    window_before_days: int | None = Field(default=None, ge=0)
    window_after_days: int | None = Field(default=None, ge=0)


class Edge(BaseModel):
    """A typed relationship between two protocol nodes."""

    model_config = ConfigDict(extra="allow", use_enum_values=True)

    id: str | None = None
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)
    type: EdgeType
    confidence: float | None = Field(default=None, ge=0, le=1)


class GraphPayload(BaseModel):
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_references(self) -> GraphPayload:
        node_ids = [node.id for node in self.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("Node IDs must be unique")

        known_ids = set(node_ids)
        for edge in self.edges:
            missing = {
                node_id
                for node_id in (edge.source, edge.target)
                if node_id not in known_ids
            }
            if missing:
                names = ", ".join(sorted(missing))
                raise ValueError(f"Edge references missing node(s): {names}")
        return self


class PageText(BaseModel):
    page: int = Field(ge=1)
    text: str = Field(min_length=1)


class Evidence(BaseModel):
    node_id: str = Field(min_length=1)
    page: int | None = Field(default=None, ge=1)
    quote: str | None = None


class Finding(BaseModel):
    id: str = Field(min_length=1)
    check_id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    tier: str = Field(min_length=1)
    evidence: list[Evidence] = Field(default_factory=list)


ExtractionAction = Literal[
    "dropped_node",
    "dropped_edge",
    "merged_edge",
    "stripped_field",
    "corrected_page",
    "fuzzy_match",
]


class ExtractionIssue(BaseModel):
    """A repair or removal made while checking an extracted graph."""

    rule: str = Field(min_length=1)
    action: ExtractionAction
    item_id: str = Field(min_length=1)
    message: str = Field(min_length=1)


ScheduleValue = Annotated[StrictInt, Field(ge=0)]
EDITABLE_SCHEDULE_FIELDS = frozenset(
    {"required_day", "day", "window_before_days", "window_after_days"}
)


class SimulationRequest(BaseModel):
    graph: GraphPayload
    node_id: str = Field(min_length=1)
    changes: dict[str, ScheduleValue]

    @field_validator("changes")
    @classmethod
    def validate_changes(
        cls, changes: dict[str, ScheduleValue]
    ) -> dict[str, ScheduleValue]:
        if not changes:
            raise ValueError("At least one schedule change is required")
        unsupported = set(changes) - EDITABLE_SCHEDULE_FIELDS
        if unsupported:
            names = ", ".join(sorted(unsupported))
            raise ValueError(f"Unsupported schedule field(s): {names}")
        return changes


class ValidationResponse(BaseModel):
    graph: GraphPayload
    issues: list[Finding] = Field(default_factory=list)


class SimulationResponse(BaseModel):
    changed_node: str
    affected_nodes: list[str] = Field(default_factory=list)
    new_issues: list[Finding] = Field(default_factory=list)
    resolved_issues: list[Finding] = Field(default_factory=list)
    remaining_issues: list[Finding] = Field(default_factory=list)


class AnalysisSummary(BaseModel):
    analysis_id: str
    filename: str
    created_at: datetime


class AnalysisResponse(BaseModel):
    analysis_id: str
    graph: GraphPayload
    findings: list[Finding] = Field(default_factory=list)
    extraction_issues: list[ExtractionIssue] = Field(default_factory=list)


class HistoryResponse(BaseModel):
    analyses: list[AnalysisSummary] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    detail: str
