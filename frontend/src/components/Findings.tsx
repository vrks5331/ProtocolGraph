import { ArrowUpRight, CheckCircle2, CircleAlert } from 'lucide-react';
import type { Finding, GraphPayload, Selection } from '../lib/types';
import { relatedNodes } from '../lib/analysisAdapter';

export default function Findings({ graph, findings, selection, onSelect }: { graph: GraphPayload; findings: Finding[]; selection: Selection; onSelect: (selection: Selection) => void }) {
  return findings.length ? <div className="findings-list">{findings.map(finding => {
    const nodes = relatedNodes(finding.check_id, graph);
    return <button key={finding.id} className={`finding-row ${selection?.kind === 'finding' && selection.id === finding.id ? 'active' : ''}`} onClick={() => onSelect({ kind: 'finding', id: finding.id })}>
      <CircleAlert size={17} className={finding.tier === 'verified' ? 'red' : 'amber'} />
      <span className="finding-copy"><strong>{finding.title}</strong><small>{finding.check_id === 'eligibility_conflict' ? 'Minimum age · 18 vs 21' : 'Response assessment · Day 42 vs Day 0'}</small></span>
      <span className="finding-meta"><span className={finding.tier === 'verified' ? 'red' : 'amber'}>{finding.tier === 'verified' ? 'Verified contradiction' : 'Missing dependency'}</span><small>{nodes.length} concepts · {finding.evidence.length} source {finding.evidence.length === 1 ? 'passage' : 'passages'}</small></span>
      <ArrowUpRight size={15} className="finding-action" />
    </button>;
  })}</div> : <div className="empty-state"><CheckCircle2 size={20} /><div><strong>No issues detected in demo rules</strong><p>Eligibility and assessment timing are consistent in the two sample checks.</p></div></div>;
}
