import { conceptLabel, edgeId, humanize } from './graphUtils';
import type { Concept, Edit, EditEntity, GraphPayload, NodeType, Relationship } from './types';

export type FieldKind = 'text' | 'longtext' | 'integer' | 'days' | 'value' | 'tristate' | 'list';

export interface FieldSpec {
  field: string;
  label: string;
  kind: FieldKind;
  /** Whether the consistency checks read this field, so editing it can change findings. */
  affectsChecks: boolean;
  /** What the field means, in everyday words. */
  help: string;
}

const TEXT_FIELDS: FieldSpec[] = [
  {
    field: 'label',
    label: 'Label',
    kind: 'text',
    affectsChecks: false,
    help: 'The name shown for this item. The checks ignore it.',
  },
  {
    field: 'description',
    label: 'Description',
    kind: 'longtext',
    affectsChecks: false,
    help: 'Longer notes about this item. The checks ignore it.',
  },
];

const TYPE_FIELDS: Partial<Record<NodeType, FieldSpec[]>> = {
  visit: [
    {
      field: 'day',
      label: 'Study day',
      kind: 'integer',
      affectsChecks: true,
      help: 'When this visit happens. Day 1 is usually the first treatment; negative days are before treatment starts, such as screening.',
    },
    {
      field: 'window_before_days',
      label: 'Window before (days)',
      kind: 'days',
      affectsChecks: true,
      help: 'How many days early the visit may happen and still count.',
    },
    {
      field: 'window_after_days',
      label: 'Window after (days)',
      kind: 'days',
      affectsChecks: true,
      help: 'How many days late the visit may happen and still count. A day 28 visit with 3 days after covers days 28 to 31.',
    },
  ],
  endpoint: [
    {
      field: 'required_day',
      label: 'Required day',
      kind: 'days',
      affectsChecks: true,
      help: 'The study day this result must be measured on. The checks look for a visit, linked through a procedure, whose window includes this day.',
    },
  ],
  eligibility: [
    {
      field: 'value',
      label: 'Value',
      kind: 'value',
      affectsChecks: true,
      help: 'The cutoff for this rule, such as a minimum age. The checks flag rules about the same thing that give different cutoffs.',
    },
  ],
};

export const EDGE_FIELDS: FieldSpec[] = [
  {
    field: 'required',
    label: 'Required',
    kind: 'tristate',
    affectsChecks: false,
    help: 'Whether the protocol says this link is mandatory or optional.',
  },
  {
    field: 'condition_text',
    label: 'Condition',
    kind: 'longtext',
    affectsChecks: false,
    help: 'When this link applies, for example "if measurable disease".',
  },
  {
    field: 'arm_ids',
    label: 'Arms',
    kind: 'list',
    affectsChecks: false,
    help: 'The treatment groups (arms) this link applies to.',
  },
  {
    field: 'pop_ids',
    label: 'Populations',
    kind: 'list',
    affectsChecks: false,
    help: 'The groups of participants this link applies to.',
  },
];

export function nodeFields(type: NodeType): FieldSpec[] {
  return [...TEXT_FIELDS, ...(TYPE_FIELDS[type] ?? [])];
}

export function fieldSpec(entity: EditEntity, field: string): FieldSpec | undefined {
  const all =
    entity === 'edge' ? EDGE_FIELDS : [...TEXT_FIELDS, ...Object.values(TYPE_FIELDS).flat()];
  return all.find((spec) => spec.field === field);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const editKey = (edit: Pick<Edit, 'entity' | 'target_id' | 'field'>) =>
  `${edit.entity}:${edit.target_id}:${edit.field}`;

export type EditAction =
  | { type: 'set'; edit: Edit }
  | { type: 'undo'; key: string }
  | { type: 'clear' }
  | { type: 'load'; edits: Edit[] };

/**
 * The scenario's edit log. A second change to the same field keeps the original `before`,
 * and a change back to the original value drops the entry.
 */
export function editsReducer(edits: Edit[], action: EditAction): Edit[] {
  switch (action.type) {
    case 'set': {
      const key = editKey(action.edit);
      const index = edits.findIndex((edit) => editKey(edit) === key);
      if (index === -1) {
        return same(action.edit.before, action.edit.after) ? edits : [...edits, action.edit];
      }
      const merged = { ...edits[index], after: action.edit.after };
      return same(merged.before, merged.after)
        ? edits.filter((_, i) => i !== index)
        : edits.map((edit, i) => (i === index ? merged : edit));
    }
    case 'undo':
      return edits.filter((edit) => editKey(edit) !== action.key);
    case 'clear':
      return [];
    case 'load':
      return action.edits;
  }
}

export function applyEdits(graph: GraphPayload, edits: Edit[]): GraphPayload {
  if (!edits.length) return graph;
  const changes = new Map<string, Record<string, unknown>>();
  for (const edit of edits) {
    const key = `${edit.entity}:${edit.target_id}`;
    changes.set(key, { ...changes.get(key), [edit.field]: edit.after });
  }
  return {
    nodes: graph.nodes.map((node) => {
      const change = changes.get(`node:${node.id}`);
      return change ? ({ ...node, ...change } as Concept) : node;
    }),
    edges: graph.edges.map((edge) => {
      const change = changes.get(`edge:${edgeId(edge)}`);
      return change ? ({ ...edge, ...change } as Relationship) : edge;
    }),
  };
}

export function editedIds(edits: Edit[]): Set<string> {
  return new Set(edits.map((edit) => edit.target_id));
}

export function formatValue(value: unknown): string {
  if (value == null || value === '') return 'unset';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
  return String(value);
}

export function targetLabel(edit: Pick<Edit, 'entity' | 'target_id'>, graph: GraphPayload): string {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (edit.entity === 'node') return conceptLabel(nodes.get(edit.target_id), edit.target_id);
  const edge = graph.edges.find((item) => edgeId(item) === edit.target_id);
  if (!edge) return edit.target_id;
  return `${conceptLabel(nodes.get(edge.source), edge.source)} → ${conceptLabel(
    nodes.get(edge.target),
    edge.target,
  )}`;
}

/** The edit as a sentence, e.g. `Baseline visit: study day changed from 0 to 42.` */
export function describeEdit(edit: Edit, graph: GraphPayload): string {
  const name = fieldSpec(edit.entity, edit.field)?.label ?? humanize(edit.field);
  return `${targetLabel(edit, graph)}: ${name.toLowerCase()} changed from ${formatValue(
    edit.before,
  )} to ${formatValue(edit.after)}.`;
}
