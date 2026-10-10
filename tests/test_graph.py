import json
from pathlib import Path
from backend.graph_engine import build_graph
from backend.rules import validate
from backend.simulator import simulate

ROOT = Path(__file__).resolve().parents[1]

def load(name):
    return build_graph(json.loads((ROOT / 'data' / f'{name}.json').read_text()))

def test_baseline_has_no_findings():
    assert validate(load('baseline')) == []

def test_injected_has_both_expected_findings():
    assert {x['check_id'] for x in validate(load('injected'))} == {'eligibility_conflict','missing_assessment'}

def test_simulator_creates_issue():
    result = simulate(load('baseline'), 'endpoint_response', {'required_day': 70})
    assert {x['check_id'] for x in result['new_issues']} == {'missing_assessment'}

def test_simulator_can_resolve_issue():
    result = simulate(load('injected'), 'visit_baseline', {'day': 42})
    assert {x['check_id'] for x in result['resolved_issues']} == {'missing_assessment'}
    assert {x['check_id'] for x in result['remaining_issues']} == {'eligibility_conflict'}

def test_original_graph_unchanged():
    graph = load('baseline')
    simulate(graph, 'endpoint_response', {'required_day': 70})
    assert graph.nodes['endpoint_response']['required_day'] == 42