import type { Concept, EdgeType, NodeType, Relationship } from './types';

export const TYPE_EXPLANATIONS: Record<NodeType, string> = {
  objective:
    'An objective is a question the study is trying to answer, such as whether a drug shrinks tumors.',
  endpoint:
    'An endpoint is the result the study measures to judge whether the treatment works or is safe, such as tumor size or survival time.',
  procedure:
    'A procedure is something done to participants during the study, like a scan, blood test, or giving the treatment.',
  visit:
    'A visit is a scheduled appointment. Study days count from the first treatment (day 1); negative days happen before treatment starts. The window is how many days early or late the visit may happen.',
  eligibility:
    'An eligibility criterion is a rule for who may join the study (inclusion) or who may not (exclusion), such as minimum age.',
  analysis: 'An analysis is the statistical method used to turn the measurements into conclusions.',
};

const RELATIONSHIP_TEMPLATES: Record<EdgeType, (source: string, target: string) => string> = {
  SUPPORTS: (source, target) => `${target} is measured to answer the objective “${source}”.`,
  MEASURED_BY: (source, target) => `${source} is measured using ${target}.`,
  SCHEDULED_AT: (source, target) => `${source} is done at ${target}.`,
  ANALYZED_BY: (source, target) => `Results for ${source} are evaluated with ${target}.`,
  REQUIRES_AT: (source, target) => `The rule “${source}” is checked at ${target}.`,
};

/** A plain-language sentence describing one relationship, with the protocol's qualifiers. */
export function relationshipSentence(
  edge: Relationship,
  source: Concept | undefined,
  target: Concept | undefined,
): string {
  const name = (node: Concept | undefined, fallback: string) => node?.label || node?.id || fallback;
  const template = RELATIONSHIP_TEMPLATES[edge.type];
  const parts = [
    template
      ? template(name(source, edge.source), name(target, edge.target))
      : `${name(source, edge.source)} is linked to ${name(target, edge.target)}.`,
  ];
  if (edge.required === true) parts.push('The protocol says this is mandatory.');
  if (edge.required === false) parts.push('The protocol says this is optional.');
  if (edge.condition_text) parts.push(`Only when: ${edge.condition_text}.`);
  if (edge.arm_ids?.length) parts.push(`Applies to treatment groups: ${edge.arm_ids.join(', ')}.`);
  if (edge.pop_ids?.length) parts.push(`Applies to: ${edge.pop_ids.join(', ')}.`);
  return parts.join(' ');
}
