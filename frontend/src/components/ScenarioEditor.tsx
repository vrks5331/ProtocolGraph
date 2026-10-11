import { useEffect, useState, type Dispatch } from 'react';
import {
  ArrowDown,
  CheckCircle2,
  LoaderCircle,
  MousePointerClick,
  Play,
  Save,
  Undo2,
} from 'lucide-react';
import { explainConcept, explainRelationship } from '../lib/api';
import { outcomeSummary } from '../lib/effects';
import { TYPE_EXPLANATIONS, relationshipSentence } from '../lib/glossary';
import PlainLanguage from './PlainLanguage';
import {
  EDGE_FIELDS,
  describeEdit,
  editKey,
  formatValue,
  nodeFields,
  targetLabel,
  type EditAction,
  type FieldSpec,
} from '../lib/edits';
import { conceptLabel, edgeId, humanize } from '../lib/graphUtils';
import type {
  Edit,
  EditEntity,
  GraphPayload,
  Relationship,
  ScenarioResponse,
  Selection,
} from '../lib/types';

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

function toText(value: unknown): string {
  if (value == null) return '';
  return Array.isArray(value) ? value.join(', ') : String(value);
}

function parse(spec: FieldSpec, text: string, original: unknown): Parsed {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };
  switch (spec.kind) {
    case 'integer':
      return /^-?\d+$/.test(trimmed)
        ? { ok: true, value: Number(trimmed) }
        : { ok: false, error: 'Enter a whole number of days (negative is before day 0).' };
    case 'days':
      return /^\d+$/.test(trimmed)
        ? { ok: true, value: Number(trimmed) }
        : { ok: false, error: 'Enter a whole number of days, 0 or more.' };
    case 'value':
      if (typeof original === 'number' && /^-?\d+(\.\d+)?$/.test(trimmed)) {
        return { ok: true, value: Number(trimmed) };
      }
      if (typeof original === 'boolean' && /^(true|false)$/i.test(trimmed)) {
        return { ok: true, value: trimmed.toLowerCase() === 'true' };
      }
      return { ok: true, value: trimmed };
    case 'list':
      return {
        ok: true,
        value: trimmed
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      };
    default:
      return { ok: true, value: text };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function FieldInput({
  spec,
  value,
  original,
  disabled,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  original: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(() => toText(value));
  const [error, setError] = useState<string | null>(null);
  const id = `field-${spec.field}`;

  useEffect(() => {
    const parsed = parse(spec, text, original);
    if (!parsed.ok || !same(parsed.value, value)) {
      setText(toText(value));
      setError(null);
    }
    // Only an outside change (undo, discard) should overwrite what the user is typing.
  }, [value]);

  function update(next: string) {
    setText(next);
    const parsed = parse(spec, next, original);
    setError(parsed.ok ? null : parsed.error);
    if (parsed.ok) onChange(parsed.value);
  }

  const changed = !same(value, original);
  return (
    <div className={`edit-field ${changed ? 'changed' : ''}`}>
      <div className="edit-field-label">
        <label htmlFor={id}>{spec.label}</label>
        {spec.affectsChecks && (
          <span className="checks-badge" title="The consistency checks read this field">
            Affects checks
          </span>
        )}
      </div>
      {spec.kind === 'tristate' ? (
        <select
          id={id}
          disabled={disabled}
          value={value == null ? '' : value ? 'yes' : 'no'}
          onChange={(event) =>
            onChange(event.target.value === '' ? null : event.target.value === 'yes')
          }
        >
          <option value="">Unspecified</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      ) : spec.kind === 'longtext' ? (
        <textarea
          id={id}
          rows={3}
          disabled={disabled}
          value={text}
          onChange={(event) => update(event.target.value)}
        />
      ) : (
        <input
          id={id}
          disabled={disabled}
          inputMode={spec.kind === 'integer' || spec.kind === 'days' ? 'numeric' : undefined}
          placeholder={spec.kind === 'list' ? 'Comma-separated' : undefined}
          value={text}
          aria-invalid={error ? true : undefined}
          onChange={(event) => update(event.target.value)}
        />
      )}
      {error ? (
        <small className="form-error" role="alert">
          {error}
        </small>
      ) : (
        changed && <small className="original-value">Original: {formatValue(original)}</small>
      )}
      <small className="field-help">{spec.help}</small>
    </div>
  );
}

export default function ScenarioEditor({
  baseGraph,
  graph,
  edits,
  dispatch,
  selection,
  onSelect,
  scenario,
  saving,
  saveError,
  onSave,
  analyzing,
  analyzeError,
  onAnalyze,
  onShowResults,
  suggestedName,
  analysisId,
}: {
  analysisId: string;
  onShowResults: () => void;
  baseGraph: GraphPayload;
  graph: GraphPayload;
  edits: Edit[];
  dispatch: Dispatch<EditAction>;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  scenario: ScenarioResponse | null;
  saving: boolean;
  saveError: string | null;
  onSave: (name: string) => Promise<boolean>;
  analyzing: boolean;
  analyzeError: string | null;
  onAnalyze: () => void;
  suggestedName: string;
}) {
  const locked = scenario !== null;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const target = selection?.kind === 'node' || selection?.kind === 'edge' ? selection : null;
  const find = (from: GraphPayload): Record<string, unknown> | undefined =>
    target?.kind === 'node'
      ? from.nodes.find((node) => node.id === target.id)
      : target?.kind === 'edge'
        ? from.edges.find((edge) => edgeId(edge) === target.id)
        : undefined;
  const nodesById = new Map(baseGraph.nodes.map((node) => [node.id, node]));
  const base = find(baseGraph);
  const current = find(graph);
  const baseNode = target?.kind === 'node' ? baseGraph.nodes.find((n) => n.id === target.id) : null;
  const fields = !base ? [] : baseNode ? nodeFields(baseNode.type) : EDGE_FIELDS;

  function change(entity: EditEntity, targetId: string, spec: FieldSpec, after: unknown) {
    dispatch({
      type: 'set',
      edit: {
        entity,
        target_id: targetId,
        field: spec.field,
        before: base?.[spec.field] ?? null,
        after,
      },
    });
  }

  async function confirmSave() {
    if (!name.trim()) return;
    if (await onSave(name.trim())) setNaming(false);
  }

  return (
    <aside className="scenario-editor" aria-label="Scenario editor">
      <div className="panel-heading">
        <h2>{locked ? 'Scenario details' : 'Edit metadata'}</h2>
      </div>
      <div className="scenario-editor-content">
        {target && base && current ? (
          <section className="edit-target">
            <span className="inspector-type">{baseNode ? baseNode.type : 'Relationship'}</span>
            <h3>
              {baseNode
                ? conceptLabel(baseNode)
                : targetLabel({ entity: 'edge', target_id: target.id }, baseGraph)}
            </h3>
            {baseNode ? (
              <PlainLanguage
                key={`${analysisId}:${baseNode.id}`}
                cacheKey={`${analysisId}:${baseNode.id}`}
                intro={TYPE_EXPLANATIONS[baseNode.type]}
                label="Explain this in plain English"
                explain={() => explainConcept(analysisId, baseNode.id)}
              />
            ) : (
              <>
                <p className="muted edit-note">
                  {humanize(String(base.type)).toLowerCase()} · The consistency checks do not read
                  relationship details yet, so editing them cannot change findings.
                </p>
                <PlainLanguage
                  key={`${analysisId}:edge:${target.id}`}
                  cacheKey={`${analysisId}:edge:${target.id}`}
                  intro={relationshipSentence(
                    base as Relationship,
                    nodesById.get(String(base.source)),
                    nodesById.get(String(base.target)),
                  )}
                  label="Explain this connection in plain English"
                  explain={() => explainRelationship(analysisId, target.id)}
                />
              </>
            )}
            {fields.map((spec) => (
              <FieldInput
                key={`${target.id}:${spec.field}`}
                spec={spec}
                value={current[spec.field] ?? null}
                original={base[spec.field] ?? null}
                disabled={locked}
                onChange={(after) => change(target.kind, target.id, spec, after)}
              />
            ))}
          </section>
        ) : (
          <div className="inspector-prompt">
            <MousePointerClick size={22} />
            <h3>{locked ? 'Inspect the scenario' : 'Select something to edit'}</h3>
            <p>
              {locked
                ? 'Click a concept or relationship to compare its scenario values with the original.'
                : 'Click a concept or relationship in the graph to change its details.'}
            </p>
            <div className="checks-guide">
              <h4>What the checks look at</h4>
              <p>
                <strong>Schedule.</strong> If an endpoint (a result the study measures) has a
                required day, one of the visits where it is measured must fall on that day, give or
                take the visit's window. Try an endpoint's required day, or a visit's study day and
                window.
              </p>
              <p>
                <strong>Eligibility.</strong> If the protocol states the same rule about who may
                join more than once, such as minimum age, every statement must give the same cutoff.
                Try a criterion's value.
              </p>
              <p>Fields marked "Affects checks" are the only ones that can change findings.</p>
            </div>
          </div>
        )}

        <section className="pending-changes">
          <div className="pending-heading">
            <h4>
              {locked ? 'Saved edits' : 'Pending changes'} ({edits.length})
            </h4>
            {!locked && edits.length > 0 && (
              <button className="text-button" onClick={() => dispatch({ type: 'clear' })}>
                Discard all
              </button>
            )}
          </div>
          {edits.length === 0 ? (
            <p className="muted">No changes yet.</p>
          ) : (
            <ul>
              {edits.map((edit) => (
                <li key={editKey(edit)}>
                  <button
                    className="edit-sentence"
                    onClick={() => onSelect({ kind: edit.entity, id: edit.target_id })}
                  >
                    {describeEdit(edit, baseGraph)}
                  </button>
                  {!locked && (
                    <button
                      className="icon-button"
                      aria-label={`Undo: ${describeEdit(edit, baseGraph)}`}
                      onClick={() => dispatch({ type: 'undo', key: editKey(edit) })}
                    >
                      <Undo2 size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="scenario-actions">
          {!locked ? (
            naming ? (
              <form
                className="save-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void confirmSave();
                }}
              >
                <label htmlFor="scenario-name">Scenario name</label>
                <input
                  id="scenario-name"
                  autoFocus
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <div className="save-form-actions">
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={saving || !name.trim()}
                  >
                    {saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
                    Save scenario
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setNaming(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="primary-button"
                disabled={edits.length === 0}
                onClick={() => {
                  setName(suggestedName);
                  setNaming(true);
                }}
              >
                <Save size={14} /> Save edits
              </button>
            )
          ) : scenario.status === 'saved' ? (
            <>
              <p className="muted">
                Saved as <strong>{scenario.name}</strong>. Analyze it to re-run the consistency
                checks with these edits.
              </p>
              <button className="primary-button" onClick={onAnalyze} disabled={analyzing}>
                {analyzing ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
                {analyzing ? 'Analyzing…' : 'Analyze scenario'}
              </button>
            </>
          ) : (
            <div className="analyzed-note" role="status">
              <p>
                <CheckCircle2 size={14} /> Analyzed:{' '}
                <strong>
                  {outcomeSummary(
                    scenario.resolved_issues?.length ?? 0,
                    scenario.new_issues?.length ?? 0,
                  )}
                </strong>
              </p>
              <button className="text-button" onClick={onShowResults}>
                See what changed and why <ArrowDown size={13} />
              </button>
            </div>
          )}
          {(saveError || analyzeError) && (
            <p className="form-error" role="alert">
              {saveError || analyzeError}
            </p>
          )}
        </section>
      </div>
    </aside>
  );
}
