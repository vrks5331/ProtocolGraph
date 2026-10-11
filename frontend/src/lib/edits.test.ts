import { describe, expect, it } from 'vitest';
import { sampleAnalysis } from '../test/fixtures';
import { applyEdits, describeEdit, editKey, editsReducer, nodeFields } from './edits';
import type { Edit } from './types';

const day = (after: unknown, before: unknown = 0): Edit => ({
  entity: 'node',
  target_id: 'visit_baseline',
  field: 'day',
  before,
  after,
});

describe('editsReducer', () => {
  it('merges repeat edits to a field and keeps the original before value', () => {
    let edits = editsReducer([], { type: 'set', edit: day(7) });
    edits = editsReducer(edits, { type: 'set', edit: day(42, 7) });
    expect(edits).toEqual([day(42)]);
  });

  it('drops an edit that returns to the original value', () => {
    const edits = editsReducer([day(42)], { type: 'set', edit: day(0, 42) });
    expect(edits).toEqual([]);
    expect(editsReducer([], { type: 'set', edit: day(0) })).toEqual([]);
  });

  it('undoes one edit and clears all', () => {
    const label: Edit = { ...day('Week 0'), field: 'label', before: 'Baseline visit' };
    const edits = [day(42), label];
    expect(editsReducer(edits, { type: 'undo', key: editKey(label) })).toEqual([day(42)]);
    expect(editsReducer(edits, { type: 'clear' })).toEqual([]);
  });
});

describe('applyEdits', () => {
  it('returns an edited copy without changing the original graph', () => {
    const { graph } = sampleAnalysis();
    const edgeEdit: Edit = {
      entity: 'edge',
      target_id: 'endpoint_response__MEASURED_BY__ct_scan',
      field: 'required',
      before: true,
      after: false,
    };
    const edited = applyEdits(graph, [day(42), edgeEdit]);
    expect(edited.nodes.find((node) => node.id === 'visit_baseline')!.day).toBe(42);
    expect(edited.edges[0].required).toBe(false);
    expect(graph.nodes.find((node) => node.id === 'visit_baseline')!.day).toBe(0);
    expect(graph.edges[0].required).toBe(true);
    expect(describeEdit(edgeEdit, graph)).toBe(
      'Tumor response assessment → CT imaging: required changed from yes to no.',
    );
  });

  it('offers schedule fields by concept type', () => {
    expect(nodeFields('visit').map((spec) => spec.field)).toEqual([
      'label',
      'description',
      'day',
      'window_before_days',
      'window_after_days',
    ]);
    expect(nodeFields('eligibility').some((spec) => spec.field === 'value')).toBe(true);
    expect(nodeFields('procedure').every((spec) => !spec.affectsChecks)).toBe(true);
  });
});
