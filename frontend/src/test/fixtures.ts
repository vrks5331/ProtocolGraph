import injected from '../../../data/injected.json';
import type { AnalysisResponse, GraphPayload } from '../lib/types';

export function sampleAnalysis(overrides: Partial<AnalysisResponse> = {}): AnalysisResponse {
  const graph = structuredClone(injected) as GraphPayload;
  graph.edges[0] = { ...graph.edges[0], required: true, condition_text: 'If measurable disease' };
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const evidence = (id: string) => ({
    node_id: id,
    page: byId.get(id)!.page,
    quote: byId.get(id)!.source_text,
  });
  return {
    analysis_id: 'a1',
    filename: 'NCT-sample.pdf',
    created_at: '2026-10-10T15:30:00+00:00',
    graph,
    findings: [
      {
        id: 'eligibility_conflict:minimum_age',
        check_id: 'eligibility_conflict',
        node_id: 'minimum_age',
        title: 'Conflicting values for minimum_age: 18, 21',
        tier: 'verified',
        evidence: [evidence('age_synopsis'), evidence('age_eligibility')],
      },
      {
        id: 'missing_assessment:endpoint_response',
        check_id: 'missing_assessment',
        node_id: 'endpoint_response',
        title: 'No linked assessment scheduled for Tumor response assessment on study day 42',
        tier: 'missing_dependency',
        evidence: [evidence('endpoint_response')],
      },
    ],
    extraction_issues: [
      {
        rule: 'grounding',
        action: 'fuzzy_match',
        item_id: 'ct_scan',
        message: 'Quote matched the page approximately.',
      },
    ],
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
