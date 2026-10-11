import pytest
from pydantic import ValidationError

from backend.contracts import Edit, GraphPayload, ScenarioCreate


def test_graph_payload_accepts_valid_graph():
    payload = GraphPayload.model_validate(
        {
            "nodes": [
                {"id": "endpoint", "type": "endpoint", "required_day": 42},
                {"id": "scan", "type": "procedure"},
            ],
            "edges": [
                {
                    "source": "endpoint",
                    "target": "scan",
                    "type": "MEASURED_BY",
                }
            ],
        }
    )

    assert payload.nodes[0].id == "endpoint"
    assert payload.edges[0].type == "MEASURED_BY"


def test_graph_payload_rejects_duplicate_node_ids():
    with pytest.raises(ValidationError, match="Node IDs must be unique"):
        GraphPayload.model_validate(
            {
                "nodes": [
                    {"id": "same", "type": "visit"},
                    {"id": "same", "type": "procedure"},
                ]
            }
        )


def test_graph_payload_rejects_missing_edge_node():
    with pytest.raises(ValidationError, match="missing node"):
        GraphPayload.model_validate(
            {
                "nodes": [{"id": "endpoint", "type": "endpoint"}],
                "edges": [
                    {
                        "source": "endpoint",
                        "target": "unknown",
                        "type": "MEASURED_BY",
                    }
                ],
            }
        )


def test_graph_payload_rejects_unknown_types():
    with pytest.raises(ValidationError):
        GraphPayload.model_validate(
            {"nodes": [{"id": "node", "type": "not-a-node-type"}]}
        )


@pytest.mark.parametrize(
    "entity, field, after",
    [
        ("node", "day", -3),
        ("node", "required_day", 0),
        ("node", "label", "Week 6 visit"),
        ("node", "value", "18 years"),
        ("node", "window_after_days", None),
        ("edge", "required", False),
        ("edge", "arm_ids", ["arm_a"]),
    ],
)
def test_edit_accepts_supported_values(entity, field, after):
    edit = Edit(entity=entity, target_id="x", field=field, after=after, before=1)
    assert edit.after == after


@pytest.mark.parametrize(
    "entity, field, after",
    [
        ("node", "day", True),
        ("node", "day", 1.5),
        ("node", "window_before_days", -1),
        ("node", "required_day", -1),
        ("node", "label", 1),
        ("node", "page", 3),
        ("node", "required", True),
        ("edge", "required", "yes"),
        ("edge", "day", 1),
        ("edge", "arm_ids", "arm_a"),
    ],
)
def test_edit_rejects_unsupported_fields_and_values(entity, field, after):
    with pytest.raises(ValidationError):
        Edit(entity=entity, target_id="x", field=field, after=after)


def test_edit_rejects_no_op():
    with pytest.raises(ValidationError, match="changes nothing"):
        Edit(entity="node", target_id="x", field="day", before=4, after=4)


def test_scenario_requires_name_and_unique_edits():
    edit = {"entity": "node", "target_id": "x", "field": "day", "after": 1}
    assert ScenarioCreate(name="  Later visit ", edits=[edit]).name == "Later visit"
    for bad in [{"name": " ", "edits": [edit]}, {"name": "x", "edits": []},
                {"name": "x", "edits": [edit, {**edit, "after": 2}]}]:
        with pytest.raises(ValidationError):
            ScenarioCreate.model_validate(bad)
