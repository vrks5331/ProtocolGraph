import baseline from '../../../data/baseline.json';
import injected from '../../../data/injected.json';
import type { AnalysisResponse, DatasetId, GraphPayload, ScheduleField, SimulationResult } from './types';

// Demo metadata is deliberately separate from timestamped backend history.
export const demoAnalyses: { id: DatasetId; name: string; description: string }[] = [
  { id: 'baseline', name: 'Baseline protocol', description: 'Consistent eligibility and day 42 assessment schedule' },
  { id: 'injected', name: 'Protocol with issues', description: 'Conflicting age criteria and an unscheduled day 42 assessment' },
];
const graphs = { baseline, injected } as Record<DatasetId, GraphPayload>;
export function getAnalysis(id: DatasetId): AnalysisResponse {
  const graph = structuredClone(graphs[id]);
  const ageNodes = graph.nodes.filter(n => n.type === 'eligibility' && n.field === 'minimum_age');
  const evidence = (nodes: typeof graph.nodes) => nodes.map(n => ({ node_id: n.id, page: n.page, quote: n.source_text }));
  const findings: AnalysisResponse['findings'] = [];
  // These are the two canonical demo scenarios, not a live rules engine.
  if (id === 'injected') {
    findings.push({ id: 'eligibility_conflict:minimum_age', check_id: 'eligibility_conflict', node_id: 'minimum_age', title: 'Eligibility conflict', tier: 'verified', evidence: evidence(ageNodes) });
    const endpoint = graph.nodes.find(n => n.id === 'endpoint_response')!;
    findings.push({ id: 'missing_assessment:endpoint_response', check_id: 'missing_assessment', node_id: endpoint.id, title: 'Missing assessment', tier: 'missing_dependency', evidence: evidence([endpoint]) });
  }
  return { analysis_id: id, graph, findings };
}
export const analysisAdapter = {
  listAnalyses: () => demoAnalyses,
  getAnalysis,
  getGraph: (id: DatasetId) => getAnalysis(id).graph,
  analyzeProtocol: async (_file: File): Promise<AnalysisResponse> => { throw new Error('PDF ingestion will be connected during integration.'); },
  simulate: simulateSchedule,
};
export function relatedNodes(checkId: string, graph: GraphPayload): string[] {
  return graph.nodes.filter(n => checkId === 'eligibility_conflict' ? n.type === 'eligibility' : ['endpoint', 'procedure', 'visit'].includes(n.type)).map(n => n.id);
}
export function findingExplanation(checkId: string): string {
  return checkId === 'eligibility_conflict'
    ? 'Minimum age is 18 in the synopsis and 21 in the eligibility passage. Review these source passages to reconcile the criterion.'
    : 'The response endpoint requires study day 42. Its linked CT assessment is scheduled at baseline, day 0, with no visit window covering day 42.';
}

/** Local counterpart for the two demo checks; never mutates source analyses. */
export function simulateSchedule(analysis: AnalysisResponse, nodeId: string,
  changes: Partial<Record<ScheduleField, number>>): SimulationResult {
  const graph = structuredClone(analysis.graph);
  const node = graph.nodes.find(n => n.id === nodeId);
  const allowed = ['required_day', 'day', 'window_before_days', 'window_after_days'];
  if (!node || !Object.keys(changes).length || Object.entries(changes).some(([key, value]) => !allowed.includes(key) || !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Select a concept and enter nonnegative integer schedule values.');
  }
  Object.assign(node, changes);
  const after = analysis.findings.filter(f => f.check_id !== 'missing_assessment');
  for (const endpoint of graph.nodes.filter(n => n.type === 'endpoint' && n.required_day != null)) {
    const procedures = graph.edges.filter(e => e.source === endpoint.id && e.type === 'MEASURED_BY').map(e => e.target);
    const visits = graph.edges.filter(e => procedures.includes(e.source) && e.type === 'SCHEDULED_AT').map(e => graph.nodes.find(n => n.id === e.target)!);
    const covered = visits.some(v => v.day != null && v.day - Number(v.window_before_days ?? 0) <= endpoint.required_day! && endpoint.required_day! <= v.day + Number(v.window_after_days ?? 0));
    if (!covered) after.push({ id: `missing_assessment:${endpoint.id}`, check_id: 'missing_assessment', node_id: endpoint.id, title: 'Missing assessment', tier: 'missing_dependency', evidence: [{ node_id: endpoint.id, page: endpoint.page, quote: endpoint.source_text }] });
  }
  const beforeIds = new Set(analysis.findings.map(f => f.id));
  const afterIds = new Set(after.map(f => f.id));
  const connected = new Set([nodeId]);
  let grew = true;
  while (grew) { grew = false; for (const edge of graph.edges) { if (connected.has(edge.source) || connected.has(edge.target)) { for (const id of [edge.source, edge.target]) { if (!connected.has(id)) { connected.add(id); grew = true; } } } } }
  return { changed_node: nodeId, affected_nodes: [...connected].filter(id => id !== nodeId).sort(),
    new_issues: after.filter(f => !beforeIds.has(f.id)), resolved_issues: analysis.findings.filter(f => !afterIds.has(f.id)), remaining_issues: after.filter(f => beforeIds.has(f.id)) };
}
