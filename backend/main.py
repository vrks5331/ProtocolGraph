from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Any
from .graph_engine import build_graph, graph_json
from .rules import validate
from .simulator import simulate

app = FastAPI(title='ProtocolGraph graph engine')

class GraphPayload(BaseModel):
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)

class SimulationRequest(BaseModel):
    graph: GraphPayload
    node_id: str
    changes: dict[str, int]

@app.post('/validate')
def validate_graph(payload: GraphPayload):
    try:
        graph = build_graph(payload.model_dump())
        return {'graph': graph_json(graph), 'issues': validate(graph)}
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@app.post('/simulate')
def simulate_graph(request: SimulationRequest):
    try:
        graph = build_graph(request.graph.model_dump())
        return simulate(graph, request.node_id, request.changes)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc