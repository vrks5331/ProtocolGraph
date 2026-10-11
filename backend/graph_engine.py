from collections.abc import Mapping
from typing import Any

import networkx as nx

from .contracts import GraphPayload


def edge_key(edge: Mapping[str, Any] | Any) -> str:
    """The edge's stored id, or the stable id derived from its endpoints."""
    get = edge.get if isinstance(edge, Mapping) else lambda name: getattr(edge, name)
    return get("id") or f"{get('source')}__{get('type')}__{get('target')}"


def build_graph(payload: GraphPayload | Mapping[str, Any]) -> nx.DiGraph:
    """Build a NetworkX graph from a structurally validated payload."""
    validated = (
        payload
        if isinstance(payload, GraphPayload)
        else GraphPayload.model_validate(payload)
    )
    data = validated.model_dump(exclude_none=True)
    graph = nx.DiGraph()
    for node in data["nodes"]:
        node_id = node.pop("id")
        graph.add_node(node_id, **node)
    for edge in data["edges"]:
        source = edge.pop("source")
        target = edge.pop("target")
        graph.add_edge(source, target, **edge)
    return graph


def graph_json(graph: nx.DiGraph) -> dict:
    payload = GraphPayload.model_validate(
        {
            "nodes": [{"id": node_id, **dict(data)} for node_id, data in graph.nodes(data=True)],
            "edges": [
                {"source": source, "target": target, **dict(data)}
                for source, target, data in graph.edges(data=True)
            ],
        }
    )
    return payload.model_dump(exclude_none=True)