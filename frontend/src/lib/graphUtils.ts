import type {
  Concept,
  ExtractionIssue,
  Finding,
  GraphPayload,
  NodeType,
  Relationship,
  Selection,
} from './types';

export const TYPE_COLORS: Record<NodeType, string> = {
  objective: '#a9b8e0',
  endpoint: '#92cbbb',
  procedure: '#9fb7a8',
  visit: '#7fa6c9',
  eligibility: '#c9a0b8',
  analysis: '#b8c97f',
};

export function edgeId(edge: Relationship): string {
  return edge.id || `${edge.source}__${edge.type}__${edge.target}`;
}

export function conceptLabel(node: Concept | undefined, fallback = ''): string {
  return node?.label || node?.id || fallback;
}

export function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}

function linkedTargets(graph: GraphPayload, sources: Iterable<string>, type: string): string[] {
  const from = new Set(sources);
  return graph.edges.filter((e) => e.type === type && from.has(e.source)).map((e) => e.target);
}

function assessmentPath(finding: Finding, graph: GraphPayload) {
  const procedures = linkedTargets(graph, [finding.node_id], 'MEASURED_BY');
  const visits = linkedTargets(graph, procedures, 'SCHEDULED_AT');
  return { procedures, visits };
}

/** The selected concept plus anything directly connected to it. */
export function neighborhood(graph: GraphPayload, selection: Selection): string[] {
  if (selection?.kind === 'edge') {
    const edge = graph.edges.find((item) => edgeId(item) === selection.id);
    return edge
      ? graph.nodes
          .filter((node) => node.id === edge.source || node.id === edge.target)
          .map((n) => n.id)
      : [];
  }
  if (selection?.kind !== 'node') return [];
  const ids = new Set([selection.id]);
  for (const edge of graph.edges) {
    if (edge.source === selection.id) ids.add(edge.target);
    if (edge.target === selection.id) ids.add(edge.source);
  }
  return graph.nodes.filter((node) => ids.has(node.id)).map((node) => node.id);
}

export interface SearchHit {
  kind: 'node' | 'edge';
  id: string;
  label: string;
  detail: string;
}

function haystack(parts: unknown[]) {
  return parts
    .filter((part) => part != null && part !== '')
    .map((part) => String(part).toLowerCase())
    .join(' ');
}

/** Concepts and relationships whose name, type, or id contains the query. */
export function searchGraph(graph: GraphPayload, query: string, limit = 8): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const hits: SearchHit[] = [];
  for (const node of graph.nodes) {
    if (haystack([node.label, node.id, node.type, node.description, node.field]).includes(needle)) {
      hits.push({
        kind: 'node',
        id: node.id,
        label: conceptLabel(node),
        detail: node.type,
      });
    }
  }
  for (const edge of graph.edges) {
    const id = edgeId(edge);
    const source = conceptLabel(nodes.get(edge.source), edge.source);
    const target = conceptLabel(nodes.get(edge.target), edge.target);
    if (haystack([id, edge.type, source, target, edge.condition_text]).includes(needle)) {
      hits.push({
        kind: 'edge',
        id,
        label: `${source} → ${target}`,
        detail: humanize(edge.type).toLowerCase(),
      });
    }
  }
  return hits.slice(0, limit);
}

/** Concepts a finding refers to, in graph order. */
export function relatedNodes(finding: Finding, graph: GraphPayload): string[] {
  const ids = new Set([finding.node_id, ...finding.evidence.map((item) => item.node_id)]);
  if (finding.check_id === 'missing_assessment') {
    const { procedures, visits } = assessmentPath(finding, graph);
    for (const id of [...procedures, ...visits]) ids.add(id);
  }
  return graph.nodes.filter((node) => ids.has(node.id)).map((node) => node.id);
}

function nodesById(graph: GraphPayload) {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function conflictValues(finding: Finding, graph: GraphPayload): string[] {
  const nodes = nodesById(graph);
  const values = finding.evidence
    .map((item) => nodes.get(item.node_id)?.value)
    .filter((value) => value != null)
    .map(String);
  return [...new Set(values)];
}

function scheduledDays(finding: Finding, graph: GraphPayload): number[] {
  const nodes = nodesById(graph);
  const days = assessmentPath(finding, graph)
    .visits.map((id) => nodes.get(id)?.day)
    .filter((day): day is number => typeof day === 'number');
  return [...new Set(days)].sort((a, b) => a - b);
}

/** One-line context shown under a finding title. */
export function findingSummary(finding: Finding, graph: GraphPayload): string {
  const node = nodesById(graph).get(finding.node_id);
  if (finding.check_id === 'eligibility_conflict') {
    const values = conflictValues(finding, graph);
    return values.length
      ? `${humanize(finding.node_id)} · ${values.join(' vs ')}`
      : humanize(finding.node_id);
  }
  if (finding.check_id === 'missing_assessment') {
    const days = scheduledDays(finding, graph);
    const scheduled = days.length
      ? days.map((day) => `Day ${day}`).join(', ')
      : 'no scheduled visit';
    const required = node?.required_day != null ? `Day ${node.required_day}` : 'required day';
    return `${conceptLabel(node, finding.node_id)} · ${required} vs ${scheduled}`;
  }
  return conceptLabel(node, finding.node_id);
}

export function findingExplanation(finding: Finding, graph: GraphPayload): string {
  const node = nodesById(graph).get(finding.node_id);
  if (finding.check_id === 'eligibility_conflict') {
    const values = conflictValues(finding, graph);
    return `The protocol gives different values for ${humanize(finding.node_id)}${
      values.length ? ` (${values.join(', ')})` : ''
    }. Review the source passages to reconcile the criterion.`;
  }
  if (finding.check_id === 'missing_assessment') {
    const days = scheduledDays(finding, graph);
    const label = conceptLabel(node, finding.node_id);
    const linked = days.length
      ? `Its linked assessments are scheduled on ${days.map((day) => `day ${day}`).join(', ')}, and no visit window covers the required day.`
      : 'No linked assessment is scheduled at any visit.';
    return `${label} must be assessed on study day ${node?.required_day ?? 'unknown'}. ${linked}`;
  }
  return 'Review the source passages for this finding.';
}

export function issuesFor(itemId: string, issues: ExtractionIssue[] = []): ExtractionIssue[] {
  return issues.filter((issue) => issue.item_id === itemId);
}

export function fuzzyMatchedNodes(issues: ExtractionIssue[] = []): Set<string> {
  return new Set(
    issues.filter((issue) => issue.action === 'fuzzy_match').map((issue) => issue.item_id),
  );
}
