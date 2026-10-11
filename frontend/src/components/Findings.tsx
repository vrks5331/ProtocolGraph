import { ArrowUpRight, CheckCircle2, CircleAlert } from 'lucide-react';
import type { Finding, GraphPayload, Selection } from '../lib/types';
import { findingSummary, relatedNodes } from '../lib/graphUtils';

export default function Findings({
  graph,
  findings,
  selection,
  onSelect,
}: {
  graph: GraphPayload;
  findings: Finding[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  return findings.length ? (
    <div className="findings-list">
      {findings.map((finding) => {
        const nodes = relatedNodes(finding, graph);
        return (
          <button
            key={finding.id}
            className={`finding-row ${selection?.kind === 'finding' && selection.id === finding.id ? 'active' : ''}`}
            onClick={() => onSelect({ kind: 'finding', id: finding.id })}
          >
            <CircleAlert size={17} className={finding.tier === 'verified' ? 'red' : 'amber'} />
            <span className="finding-copy">
              <strong>{finding.title}</strong>
              <small>{findingSummary(finding, graph)}</small>
            </span>
            <span className="finding-meta">
              <span className={finding.tier === 'verified' ? 'red' : 'amber'}>
                {finding.tier === 'verified' ? 'Verified contradiction' : 'Missing dependency'}
              </span>
              <small>
                {nodes.length} {nodes.length === 1 ? 'concept' : 'concepts'} ·{' '}
                {finding.evidence.length} source{' '}
                {finding.evidence.length === 1 ? 'passage' : 'passages'}
              </small>
            </span>
            <ArrowUpRight size={15} className="finding-action" />
          </button>
        );
      })}
    </div>
  ) : (
    <div className="empty-state">
      <CheckCircle2 size={20} />
      <div>
        <strong>No issues found</strong>
        <p>No conflicting eligibility values or unscheduled endpoint assessments were detected.</p>
      </div>
    </div>
  );
}
