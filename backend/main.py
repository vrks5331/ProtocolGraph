from fastapi import FastAPI, HTTPException

from .contracts import (
    ErrorResponse,
    GraphPayload,
    SimulationRequest,
    SimulationResponse,
    ValidationResponse,
)
from .graph_engine import build_graph, graph_json
from .rules import validate
from .simulator import simulate

app = FastAPI(title="ProtocolGraph graph engine")


@app.post(
    "/validate",
    response_model=ValidationResponse,
    responses={400: {"model": ErrorResponse}},
)
def validate_graph(payload: GraphPayload):
    try:
        graph = build_graph(payload)
        return {"graph": graph_json(graph), "issues": validate(graph)}
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post(
    "/simulate",
    response_model=SimulationResponse,
    responses={400: {"model": ErrorResponse}},
)
def simulate_graph(request: SimulationRequest):
    try:
        graph = build_graph(request.graph)
        return simulate(graph, request.node_id, request.changes)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc