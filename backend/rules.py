from __future__ import annotations
import networkx as nx


def issue(check_id, node_id, title, tier, evidence=None):
    return {'id': f'{check_id}:{node_id}', 'check_id': check_id, 'node_id': node_id,
            'title': title, 'tier': tier, 'evidence': evidence or []}


def validate(graph: nx.DiGraph) -> list[dict]:
    findings = []
    # Explicit contradictions: same eligibility property, different values in two passages.
    criteria = {}
    for node_id, data in graph.nodes(data=True):
        if data.get('type') != 'eligibility':
            continue
        key = data.get('field')
        value = data.get('value')
        if key is not None and value is not None:
            criteria.setdefault(key, []).append((node_id, value, data))
    for field, records in criteria.items():
        values = {str(value) for _, value, _ in records}
        if len(values) > 1:
            findings.append(issue('eligibility_conflict', field,
                f'Conflicting values for {field}: {", ".join(sorted(values))}',
                'verified', [{'node_id': n, 'page': d.get('page'), 'quote': d.get('source_text')}
                             for n, _, d in records]))

    # An endpoint is measurable only when its linked procedure is scheduled
    # at a visit that covers the endpoint's required day (asymmetric windows).
    for endpoint_id, endpoint in graph.nodes(data=True):
        if endpoint.get('type') != 'endpoint' or endpoint.get('required_day') is None:
            continue
        day = endpoint['required_day']
        found = False
        for procedure_id in graph.successors(endpoint_id):
            if graph[endpoint_id][procedure_id].get('type') != 'MEASURED_BY':
                continue
            for visit_id in graph.successors(procedure_id):
                if graph[procedure_id][visit_id].get('type') != 'SCHEDULED_AT':
                    continue
                visit = graph.nodes[visit_id]
                if visit.get('day') is None:
                    continue
                earliest = visit['day'] - visit.get('window_before_days', 0)
                latest = visit['day'] + visit.get('window_after_days', 0)
                if earliest <= day <= latest:
                    found = True
        if not found:
            findings.append(issue('missing_assessment', endpoint_id,
                f'No linked assessment scheduled for {endpoint.get("label", endpoint_id)} on study day {day}',
                'missing_dependency', [{'node_id': endpoint_id, 'page': endpoint.get('page'),
                                        'quote': endpoint.get('source_text')}]))
    return sorted(findings, key=lambda item: item['id'])