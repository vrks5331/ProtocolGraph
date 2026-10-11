"""What-if scenarios: apply metadata edits to a stored graph and diff the findings."""

from __future__ import annotations

from collections.abc import Iterable

from .contracts import Edit, GraphPayload
from .graph_engine import build_graph, edge_key, graph_json
from .rules import validate


class EditError(ValueError):
    """An edit that cannot be applied to the base graph."""


class StaleEditError(EditError):
    """An edit whose `before` value no longer matches the base graph."""


def apply_edits(graph: GraphPayload, edits: Iterable[Edit]) -> GraphPayload:
    data = graph.model_dump(mode="json")
    nodes = {node["id"]: node for node in data["nodes"]}
    edges = {edge_key(edge): edge for edge in data["edges"]}
    for edit in edits:
        items = nodes if edit.entity == "node" else edges
        item = items.get(edit.target_id)
        if item is None:
            raise EditError(f"Unknown {edit.entity}: {edit.target_id}")
        if edit.field == "value" and item.get("type") != "eligibility":
            raise EditError("Only eligibility criteria have an editable value")
        if item.get(edit.field) != edit.before:
            raise StaleEditError(
                f"{edit.field} on {edit.target_id} is {item.get(edit.field)!r}, "
                f"not {edit.before!r}"
            )
        item[edit.field] = edit.after
    return GraphPayload.model_validate(data)


def _referenced_nodes(finding: dict) -> set[str]:
    return {finding["node_id"], *(item["node_id"] for item in finding.get("evidence", []))}


def run_scenario(base: GraphPayload, edits: list[Edit]) -> dict:
    edited = apply_edits(base, edits)
    before = {item["id"]: item for item in validate(build_graph(base))}
    modified = build_graph(edited)
    after = {item["id"]: item for item in validate(modified)}
    new = [after[key] for key in sorted(after.keys() - before.keys())]
    resolved = [before[key] for key in sorted(before.keys() - after.keys())]

    edges = {edge_key(edge): edge for edge in edited.edges}
    affected: set[str] = set()
    for edit in edits:
        if edit.entity == "node":
            affected.add(edit.target_id)
        else:
            affected.update((edges[edit.target_id].source, edges[edit.target_id].target))
    for finding in (*new, *resolved):
        affected |= _referenced_nodes(finding)

    return {
        "graph": graph_json(modified),
        "findings": list(after.values()),
        "new_issues": new,
        "resolved_issues": resolved,
        "remaining_issues": [after[key] for key in sorted(after.keys() & before.keys())],
        "affected_nodes": sorted(affected & set(modified.nodes)),
    }
