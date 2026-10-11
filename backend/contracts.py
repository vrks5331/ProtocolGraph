from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
    TypeAdapter,
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


class ValidationResponse(BaseModel):
    graph: GraphPayload
    issues: list[Finding] = Field(default_factory=list)


NonNegativeInt = Annotated[StrictInt, Field(ge=0)]
OptionalText = Annotated[str, Field(max_length=2000)] | None

# Metadata a scenario may change, with the type each new value must have.
EDITABLE_FIELDS: dict[str, dict[str, Any]] = {
    "node": {
        "label": OptionalText,
        "description": OptionalText,
        "day": StrictInt | None,
        "required_day": NonNegativeInt | None,
        "window_before_days": NonNegativeInt | None,
        "window_after_days": NonNegativeInt | None,
        "value": StrictStr | StrictInt | StrictFloat | StrictBool | None,
    },
    "edge": {
        "required": StrictBool | None,
        "condition_text": OptionalText,
        "arm_ids": list[StrictStr] | None,
        "pop_ids": list[StrictStr] | None,
    },
}
_FIELD_ADAPTERS = {
    entity: {name: TypeAdapter(kind) for name, kind in fields.items()}
    for entity, fields in EDITABLE_FIELDS.items()
}


class Edit(BaseModel):
    """One metadata change: `before` is the base value, `after` the scenario value."""

    entity: Literal["node", "edge"]
    target_id: str = Field(min_length=1)
    field: str = Field(min_length=1)
    before: Any = None
    after: Any = None

    @model_validator(mode="after")
    def validate_value(self) -> Edit:
        adapter = _FIELD_ADAPTERS[self.entity].get(self.field)
        if adapter is None:
            raise ValueError(f"{self.field} cannot be edited on a {self.entity}")
        self.after = adapter.validate_python(self.after)
        if self.after == self.before:
            raise ValueError(f"Edit to {self.field} on {self.target_id} changes nothing")
        return self


class ScenarioCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    edits: list[Edit] = Field(min_length=1)

    @field_validator("name")
    @classmethod
    def strip_name(cls, name: str) -> str:
        if not name.strip():
            raise ValueError("Scenario name is required")
        return name.strip()

    @field_validator("edits")
    @classmethod
    def unique_edits(cls, edits: list[Edit]) -> list[Edit]:
        keys = [(edit.entity, edit.target_id, edit.field) for edit in edits]
        if len(keys) != len(set(keys)):
            raise ValueError("Each field may be edited only once per scenario")
        return edits


ScenarioStatus = Literal["saved", "analyzed"]


class ScenarioSummary(BaseModel):
    scenario_id: str
    analysis_id: str
    name: str
    created_at: datetime
    edit_count: int
    status: ScenarioStatus


class ScenarioResponse(BaseModel):
    scenario_id: str
    analysis_id: str
    name: str
    created_at: datetime
    edits: list[Edit]
    status: ScenarioStatus
    graph: GraphPayload | None = None
    findings: list[Finding] | None = None
    new_issues: list[Finding] | None = None
    resolved_issues: list[Finding] | None = None
    remaining_issues: list[Finding] | None = None
    affected_nodes: list[str] | None = None


class ScenarioListResponse(BaseModel):
    scenarios: list[ScenarioSummary] = Field(default_factory=list)


class AnalysisSummary(BaseModel):
    analysis_id: str
    filename: str
    created_at: datetime
    scenario_count: int = 0


class AnalysisResponse(BaseModel):
    analysis_id: str
    filename: str | None = None
    created_at: datetime | None = None
    graph: GraphPayload
    findings: list[Finding] = Field(default_factory=list)
    extraction_issues: list[ExtractionIssue] = Field(default_factory=list)


class HistoryResponse(BaseModel):
    analyses: list[AnalysisSummary] = Field(default_factory=list)


class JargonTerm(BaseModel):
    term: Annotated[str, Field(min_length=1)]
    meaning: Annotated[str, Field(min_length=1)]


class ConceptExplanation(BaseModel):
    """Plain-language rewrite of one concept for readers without medical training."""

    summary: Annotated[str, Field(min_length=1)]
    terms: list[JargonTerm] = Field(default_factory=list)


class ExplanationResponse(ConceptExplanation):
    item_id: str


class ErrorResponse(BaseModel):
    detail: str
