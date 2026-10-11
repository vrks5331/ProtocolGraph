import { describeEdit, fieldSpec } from './edits';
import { conceptLabel, humanize } from './graphUtils';
import type { Concept, Edit, GraphPayload } from './types';

function targets(graph: GraphPayload, sources: Iterable<string>, type: string): string[] {
  const from = new Set(sources);
  return graph.edges.filter((e) => e.type === type && from.has(e.source)).map((e) => e.target);
}

function sourcesOf(graph: GraphPayload, target: string, type: string): string[] {
  return graph.edges.filter((e) => e.type === type && e.target === target).map((e) => e.source);
}

function covers(visit: Concept, day: number) {
  if (visit.day == null) return false;
  return (
    visit.day - (visit.window_before_days ?? 0) <= day &&
    day <= visit.day + (visit.window_after_days ?? 0)
  );
}

function windowText(visit: Concept) {
  const start = visit.day! - (visit.window_before_days ?? 0);
  const end = visit.day! + (visit.window_after_days ?? 0);
  return start === end ? `day ${start}` : `days ${start} to ${end}`;
}

/** Endpoints with a required day that are measured at this visit. */
function endpointsAt(graph: GraphPayload, visitId: string, nodes: Map<string, Concept>) {
  const procedures = new Set(sourcesOf(graph, visitId, 'SCHEDULED_AT'));
  return graph.edges
    .filter((e) => e.type === 'MEASURED_BY' && procedures.has(e.target))
    .map((e) => nodes.get(e.source))
    .filter((node): node is Concept => node?.type === 'endpoint' && node.required_day != null)
    .filter((node, index, all) => all.indexOf(node) === index);
}

function endpointStatus(graph: GraphPayload, endpoint: Concept, nodes: Map<string, Concept>) {
  const visits = targets(graph, targets(graph, [endpoint.id], 'MEASURED_BY'), 'SCHEDULED_AT')
    .map((id) => nodes.get(id))
    .filter((visit): visit is Concept => visit?.day != null);
  const label = conceptLabel(endpoint);
  const day = endpoint.required_day!;
  const match = visits.find((visit) => covers(visit, day));
  if (match) {
    return `${label} must be measured on day ${day}, and ${conceptLabel(match)} (${windowText(
      match,
    )}) still covers that, so it stays fine.`;
  }
  return visits.length
    ? `${label} must be measured on day ${day}, and its visits (${visits
        .map((visit) => `${conceptLabel(visit)}: ${windowText(visit)}`)
        .join('; ')}) still don't cover that, so its finding stays.`
    : `${label} must be measured on day ${day}, but none of its visits has a study day yet, so its finding stays.`;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One-line outcome of an analyzed scenario, such as `1 new finding · 1 resolved`. */
export function outcomeSummary(resolved: number, created: number): string {
  if (!resolved && !created) return 'No findings changed';
  return [
    created && `${count(created, 'new finding')}`,
    resolved && `${count(resolved, 'finding')} resolved`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Why an edit left every finding as it was, in everyday words. Reads the scenario graph,
 * so values reflect all of the scenario's edits.
 */
export function noEffectReason(edit: Edit, graph: GraphPayload): string {
  const spec = fieldSpec(edit.entity, edit.field);
  const change = describeEdit(edit, graph);
  if (!spec?.affectsChecks) {
    const what =
      edit.entity === 'edge'
        ? 'Relationship details'
        : `The ${spec?.label.toLowerCase() ?? humanize(edit.field)}`;
    return `${change} ${what} ${edit.entity === 'edge' ? 'are' : 'is'} not used by the checks, so this edit can't change findings.`;
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const node = nodes.get(edit.target_id);
  if (!node) return change;

  if (node.type === 'visit') {
    const endpoints = endpointsAt(graph, node.id, nodes);
    if (!endpoints.length) {
      return `${change} The schedule check only looks at visits where an endpoint with a required day is measured, and no such endpoint is measured at ${conceptLabel(node)}. Give a linked endpoint a required day to see this visit's window matter.`;
    }
    return `${change} ${endpoints.map((endpoint) => endpointStatus(graph, endpoint, nodes)).join(' ')}`;
  }

  if (node.type === 'endpoint') {
    if (node.required_day == null) {
      return `${change} Without a required day, the schedule check has nothing to compare for this endpoint.`;
    }
    return `${change} ${endpointStatus(graph, node, nodes)}`;
  }

  if (node.type === 'eligibility') {
    if (!node.field) {
      return `${change} This criterion isn't tagged with what it measures, so the checks can't compare it with other criteria.`;
    }
    const others = graph.nodes.filter(
      (other) => other.type === 'eligibility' && other.field === node.field && other.id !== node.id,
    );
    const topic = humanize(node.field);
    if (!others.length) {
      return `${change} This is the only criterion about ${topic}, so there is nothing for it to conflict with. The eligibility check only flags the same rule stated twice with different cutoffs.`;
    }
    const values = new Set(
      [node, ...others].filter((item) => item.value != null).map((item) => String(item.value)),
    );
    return values.size > 1
      ? `${change} The criteria about ${topic} still give different cutoffs (${[...values].join(', ')}), so the conflict stays.`
      : `${change} All criteria about ${topic} still agree, so there is no conflict.`;
  }
  return change;
}
