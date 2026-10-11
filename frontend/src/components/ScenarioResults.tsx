import { forwardRef } from 'react';
import { CheckCircle2, CircleAlert, CircleDot, HelpCircle } from 'lucide-react';
import { explainScenario } from '../lib/api';
import { describeEdit } from '../lib/edits';
import { noEffectReason, outcomeSummary } from '../lib/effects';
import { CHECK_EXPLANATIONS } from '../lib/glossary';
import { edgeId, findingExplanation, findingSummary, relatedNodes } from '../lib/graphUtils';
import type { Edit, Finding, GraphPayload, ScenarioResponse, Selection } from '../lib/types';
import PlainLanguage from './PlainLanguage';

type Group = 'resolved' | 'new' | 'unchanged';

const GROUPS: { group: Group; title: string; empty: string }[] = [
  { group: 'resolved', title: 'Resolved', empty: 'No findings were resolved by these edits.' },
  { group: 'new', title: 'New', empty: 'The edits introduced no new findings.' },
  { group: 'unchanged', title: 'Unchanged', empty: 'No findings remain.' },
];

/** Edits that touch a concept the finding refers to. */
function editsBehind(finding: Finding, graph: GraphPayload, edits: Edit[]): Edit[] {
  const related = new Set(relatedNodes(finding, graph));
  const edges = new Map(graph.edges.map((edge) => [edgeId(edge), edge]));
  return edits.filter((edit) => {
    if (edit.entity === 'node') return related.has(edit.target_id);
    const edge = edges.get(edit.target_id);
    return Boolean(edge && related.has(edge.source) && related.has(edge.target));
  });
}

export function whyLine(
  group: Group,
  finding: Finding,
  graph: GraphPayload,
  baseGraph: GraphPayload,
  edits: Edit[],
): string {
  const causes = editsBehind(finding, graph, edits)
    .map((edit) => describeEdit(edit, baseGraph))
    .join(' ');
  if (group === 'resolved') {
    return causes
      ? `Resolved by: ${causes}`
      : 'Resolved as a side effect of the edits to connected concepts.';
  }
  if (group === 'new') {
    return `${causes ? `Introduced by: ${causes} ` : ''}${findingExplanation(finding, graph)}`;
  }
  return causes
    ? `Still present after: ${causes} ${findingExplanation(finding, graph)}`
    : 'None of the edited items are part of this finding.';
}

const ScenarioResults = forwardRef<
  HTMLElement,
  {
    scenario: ScenarioResponse;
    baseGraph: GraphPayload;
    selection: Selection;
    onSelect: (selection: Selection) => void;
  }
>(function ScenarioResults({ scenario, baseGraph, selection, onSelect }, ref) {
  const graph = scenario.graph ?? baseGraph;
  const findings: Record<Group, Finding[]> = {
    resolved: scenario.resolved_issues ?? [],
    new: scenario.new_issues ?? [],
    unchanged: scenario.remaining_issues ?? [],
  };
  const changed = findings.resolved.length + findings.new.length > 0;
  const outcome = outcomeSummary(findings.resolved.length, findings.new.length);

  return (
    <section ref={ref} className="findings-panel scenario-results" aria-label="Scenario results">
      <div className={`scenario-outcome ${changed ? 'changed' : ''}`} role="status">
        {changed ? <CircleAlert size={18} /> : <CheckCircle2 size={18} />}
        <div>
          <strong>{outcome}</strong>
          <p>
            {changed
              ? 'Compared with the original analysis. Each finding below says which edit caused it.'
              : 'The checks give the same result as the original analysis.'}{' '}
            {scenario.findings?.length ?? 0} finding
            {scenario.findings?.length === 1 ? '' : 's'} in this scenario.
          </p>
        </div>
      </div>
      {!changed && (
        <div className="no-effect">
          <h3>
            <HelpCircle size={14} /> Why nothing changed
          </h3>
          <ul>
            {scenario.edits.map((edit) => (
              <li key={`${edit.entity}:${edit.target_id}:${edit.field}`}>
                {noEffectReason(edit, graph)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {GROUPS.map(({ group, title, empty }) => (
        <div key={group} className={`result-group ${group}`}>
          <h3>
            {title} <span className="count">{findings[group].length}</span>
          </h3>
          {findings[group].length === 0 ? (
            <p className="muted">{empty}</p>
          ) : (
            <div className="findings-list">
              {findings[group].map((finding) => {
                const context = group === 'resolved' ? baseGraph : graph;
                const active = selection?.kind === 'finding' && selection.id === finding.id;
                return (
                  <button
                    key={finding.id}
                    className={`finding-row ${active ? 'active' : ''}`}
                    onClick={() => onSelect(active ? null : { kind: 'finding', id: finding.id })}
                  >
                    {group === 'resolved' ? (
                      <CheckCircle2 size={17} className="resolved-icon" />
                    ) : group === 'new' ? (
                      <CircleAlert size={17} className="red" />
                    ) : (
                      <CircleDot size={17} className="amber" />
                    )}
                    <span className="finding-copy">
                      <strong>{finding.title}</strong>
                      <small>{findingSummary(finding, context)}</small>
                      <small className="why-line">
                        {whyLine(group, finding, context, baseGraph, scenario.edits)}
                      </small>
                      {CHECK_EXPLANATIONS[finding.check_id] && (
                        <small className="plain-terms">
                          In plain terms: {CHECK_EXPLANATIONS[finding.check_id]}
                        </small>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
      <PlainLanguage
        key={scenario.scenario_id}
        cacheKey={`scenario:${scenario.scenario_id}`}
        intro="Want the whole picture in everyday words? AI can explain what these edits mean for the study, using the protocol's own text, and define any medical terms involved."
        label="Explain the effects in plain English"
        explain={() => explainScenario(scenario.scenario_id)}
      />
    </section>
  );
});

export default ScenarioResults;
