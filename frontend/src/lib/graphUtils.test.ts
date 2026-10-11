import { describe, expect, it } from 'vitest';
import { sampleAnalysis } from '../test/fixtures';
import {
  edgeId,
  findingExplanation,
  findingSummary,
  fuzzyMatchedNodes,
  issuesFor,
  relatedNodes,
} from './graphUtils';

describe('graphUtils', () => {
  const { graph, findings, extraction_issues } = sampleAnalysis();
  const [conflict, missing] = findings;

  it('relates an eligibility conflict to its evidence nodes only', () => {
    expect(relatedNodes(conflict, graph)).toEqual(['age_synopsis', 'age_eligibility']);
  });

  it('walks a missing assessment from endpoint to procedures and visits', () => {
    expect(relatedNodes(missing, graph)).toEqual([
      'endpoint_response',
      'ct_scan',
      'visit_baseline',
    ]);
  });

  it('summarizes findings from graph data', () => {
    expect(findingSummary(conflict, graph)).toBe('minimum age · 18 vs 21');
    expect(findingSummary(missing, graph)).toBe('Tumor response assessment · Day 42 vs Day 0');
    expect(findingExplanation(missing, graph)).toMatch(/study day 42.*day 0/);
  });

  it('handles an endpoint with no scheduled assessment', () => {
    const bare = { ...graph, edges: [] };
    expect(relatedNodes(missing, bare)).toEqual(['endpoint_response']);
    expect(findingSummary(missing, bare)).toBe(
      'Tumor response assessment · Day 42 vs no scheduled visit',
    );
  });

  it('derives stable edge ids and extraction issue lookups', () => {
    expect(edgeId(graph.edges[0])).toBe('endpoint_response__MEASURED_BY__ct_scan');
    expect(edgeId({ ...graph.edges[0], id: 'custom' })).toBe('custom');
    expect([...fuzzyMatchedNodes(extraction_issues)]).toEqual(['ct_scan']);
    expect(issuesFor('ct_scan', extraction_issues)).toHaveLength(1);
    expect(issuesFor('visit_baseline', extraction_issues)).toEqual([]);
  });
});
