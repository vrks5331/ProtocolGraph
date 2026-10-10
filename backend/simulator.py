import copy
import networkx as nx
from .rules import validate

EDITABLE_FIELDS = {'required_day', 'day', 'window_before_days', 'window_after_days'}

def simulate(graph: nx.DiGraph, node_id: str, changes: dict) -> dict:
    if node_id not in graph:
        raise ValueError(f'Unknown node: {node_id}')
    if not changes or set(changes) - EDITABLE_FIELDS:
        raise ValueError('Only schedule-related fields may be changed')
    for value in changes.values():
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError('Schedule values must be nonnegative integers')
    modified = copy.deepcopy(graph)
    modified.nodes[node_id].update(changes)
    before = {x['id']: x for x in validate(graph)}
    after = {x['id']: x for x in validate(modified)}
    # Dependency edges can point toward or away from the edited node.
    affected = sorted(nx.node_connected_component(modified.to_undirected(), node_id) - {node_id})
    return {'changed_node': node_id, 'affected_nodes': affected,
            'new_issues': [after[k] for k in sorted(after.keys() - before.keys())],
            'resolved_issues': [before[k] for k in sorted(before.keys() - after.keys())],
            'remaining_issues': [after[k] for k in sorted(after.keys() & before.keys())]}