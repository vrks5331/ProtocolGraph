import json
from pathlib import Path

import pytest

from backend.contracts import Edit, GraphPayload
from backend.graph_engine import build_graph
from backend.rules import validate
from backend.simulator import EditError, StaleEditError, apply_edits, run_scenario

ROOT = Path(__file__).resolve().parents[1]

def payload(name):
    return GraphPayload.model_validate_json((ROOT / 'data' / f'{name}.json').read_text())

def load(name):
    return build_graph(json.loads((ROOT / 'data' / f'{name}.json').read_text()))

def edit(target_id, field, before, after, entity='node'):
    return Edit(entity=entity, target_id=target_id, field=field, before=before, after=after)

def test_baseline_has_no_findings():
    assert validate(load('baseline')) == []

def test_injected_has_both_expected_findings():
    assert {x['check_id'] for x in validate(load('injected'))} == {'eligibility_conflict','missing_assessment'}

def test_apply_edits_changes_a_copy():
    base = payload('injected')
    edited = apply_edits(base, [edit('visit_baseline', 'day', 0, -7),
                                edit('endpoint_response__MEASURED_BY__ct_scan', 'required',
                                     None, True, 'edge')])
    assert next(n for n in edited.nodes if n.id == 'visit_baseline').day == -7
    assert edited.edges[0].required is True
    assert next(n for n in base.nodes if n.id == 'visit_baseline').day == 0
    assert base == payload('injected')

@pytest.mark.parametrize('bad, error', [
    (edit('visit_baseline', 'day', 3, 42), StaleEditError),
    (edit('missing', 'day', None, 1), EditError),
    (edit('ct_scan', 'value', None, 5), EditError),
    (edit('nope__X__y', 'required', None, True, 'edge'), EditError),
])
def test_apply_edits_rejects_stale_or_invalid(bad, error):
    with pytest.raises(error):
        apply_edits(payload('injected'), [bad])

def test_moving_visit_resolves_missing_assessment():
    result = run_scenario(payload('injected'), [edit('visit_baseline', 'day', 0, 42)])
    assert [x['check_id'] for x in result['resolved_issues']] == ['missing_assessment']
    assert [x['check_id'] for x in result['remaining_issues']] == ['eligibility_conflict']
    assert result['new_issues'] == []
    assert {'visit_baseline', 'endpoint_response'} <= set(result['affected_nodes'])
    assert {x['check_id'] for x in result['findings']} == {'eligibility_conflict'}

def test_eligibility_value_resolves_or_creates_conflict():
    resolved = run_scenario(payload('injected'), [edit('age_eligibility', 'value', 21, 18)])
    assert [x['check_id'] for x in resolved['resolved_issues']] == ['eligibility_conflict']
    created = run_scenario(payload('baseline'), [edit('age_synopsis', 'value', 18, 65)])
    assert [x['check_id'] for x in created['new_issues']] == ['eligibility_conflict']
    assert set(created['affected_nodes']) == {'age_synopsis', 'age_eligibility'}

def test_scenario_can_create_issue_and_tracks_edge_endpoints():
    result = run_scenario(payload('baseline'), [edit('endpoint_response', 'required_day', 42, 70)])
    assert [x['check_id'] for x in result['new_issues']] == ['missing_assessment']
    edge_only = run_scenario(payload('baseline'), [
        edit('endpoint_response__MEASURED_BY__ct_scan', 'condition_text', None, 'if tolerated', 'edge')])
    assert edge_only['new_issues'] == edge_only['resolved_issues'] == []
    assert edge_only['affected_nodes'] == ['ct_scan', 'endpoint_response']
