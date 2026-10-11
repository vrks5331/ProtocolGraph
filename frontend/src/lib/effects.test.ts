import { describe, expect, it } from 'vitest';
import { sampleAnalysis } from '../test/fixtures';
import { noEffectReason, outcomeSummary } from './effects';
import type { Edit, GraphPayload } from './types';

const nodeEdit = (target_id: string, field: string, before: unknown, after: unknown): Edit => ({
  entity: 'node',
  target_id,
  field,
  before,
  after,
});

function withNode(graph: GraphPayload, id: string, changes: Record<string, unknown>) {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === id ? { ...node, ...changes } : node)),
  };
}

describe('outcomeSummary', () => {
  it('summarizes resolved and new findings', () => {
    expect(outcomeSummary(0, 0)).toBe('No findings changed');
    expect(outcomeSummary(1, 0)).toBe('1 finding resolved');
    expect(outcomeSummary(2, 1)).toBe('1 new finding · 2 findings resolved');
  });
});

describe('noEffectReason', () => {
  const { graph } = sampleAnalysis();

  it('says when a field is not used by the checks', () => {
    const edit = nodeEdit('visit_baseline', 'label', 'Baseline visit', 'Week 0');
    expect(noEffectReason(edit, graph)).toMatch(/label is not used by the checks/);
  });

  it('explains a visit window that no endpoint depends on', () => {
    const unlinked = { ...graph, edges: graph.edges.filter((e) => e.type !== 'SCHEDULED_AT') };
    const edit = nodeEdit('visit_baseline', 'window_after_days', 0, 50);
    expect(
      noEffectReason(edit, withNode(unlinked, 'visit_baseline', { window_after_days: 50 })),
    ).toMatch(/no such endpoint is measured at Baseline visit/);
  });

  it('reports whether a linked endpoint is still covered', () => {
    const edit = nodeEdit('visit_baseline', 'window_after_days', 0, 10);
    const edited = withNode(graph, 'visit_baseline', { window_after_days: 10 });
    expect(noEffectReason(edit, edited)).toMatch(
      /must be measured on day 42, and its visits \(Baseline visit: days 0 to 10\) still don't cover that/,
    );
  });

  it('explains an eligibility criterion with nothing to conflict with', () => {
    const single = withNode(graph, 'age_synopsis', { field: 'other_rule' });
    const edit = nodeEdit('age_eligibility', 'value', 21, 25);
    expect(noEffectReason(edit, withNode(single, 'age_eligibility', { value: 25 }))).toMatch(
      /only criterion about minimum age, so there is nothing for it to conflict with/,
    );
    expect(noEffectReason(edit, withNode(graph, 'age_eligibility', { value: 25 }))).toMatch(
      /still give different cutoffs \(25, 18\)/,
    );
  });
});
