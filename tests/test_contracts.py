import pytest
from pydantic import ValidationError

from backend.contracts import GraphPayload, SimulationRequest


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


@pytest.mark.parametrize("value", [-1, True, 1.5])
def test_simulation_request_rejects_invalid_schedule_values(value):
    with pytest.raises(ValidationError):
        SimulationRequest.model_validate(
            {
                "graph": {"nodes": [], "edges": []},
                "node_id": "visit",
                "changes": {"day": value},
            }
        )


@pytest.mark.parametrize("changes", [{}, {"label": 1}])
def test_simulation_request_requires_supported_changes(changes):
    with pytest.raises(ValidationError):
        SimulationRequest.model_validate(
            {
                "graph": {"nodes": [], "edges": []},
                "node_id": "visit",
                "changes": changes,
            }
        )
