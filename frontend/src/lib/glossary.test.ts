import { describe, expect, it } from 'vitest';
import { relationshipSentence } from './glossary';
import type { Concept } from './types';

const objective: Concept = { id: 'obj', type: 'objective', label: 'Test efficacy' };
const endpoint: Concept = { id: 'ep', type: 'endpoint', label: 'Overall survival' };
const visit: Concept = { id: 'v', type: 'visit', label: 'Screening' };
const rule: Concept = { id: 'age', type: 'eligibility' };

describe('relationshipSentence', () => {
  it('reads each relationship type as a sentence', () => {
    expect(
      relationshipSentence({ source: 'obj', target: 'ep', type: 'SUPPORTS' }, objective, endpoint),
    ).toBe('Overall survival is measured to answer the objective “Test efficacy”.');
    expect(
      relationshipSentence({ source: 'age', target: 'v', type: 'REQUIRES_AT' }, rule, visit),
    ).toBe('The rule “age” is checked at Screening.');
  });

  it('adds the protocol qualifiers', () => {
    expect(
      relationshipSentence(
        {
          source: 'age',
          target: 'v',
          type: 'REQUIRES_AT',
          required: false,
          arm_ids: ['arm_a'],
          pop_ids: ['itt'],
        },
        rule,
        visit,
      ),
    ).toBe(
      'The rule “age” is checked at Screening. The protocol says this is optional. Applies to treatment groups: arm_a. Applies to: itt.',
    );
  });
});
