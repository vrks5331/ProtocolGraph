import { useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { analysisAdapter } from '../lib/analysisAdapter';
import type { AnalysisResponse, ScheduleField, Selection, SimulationResult } from '../lib/types';

const labels: Record<ScheduleField, string> = {
  required_day: 'Required study day',
  day: 'Scheduled study day',
  window_before_days: 'Window before (days)',
  window_after_days: 'Window after (days)',
};
export default function Simulation({
  analysis,
  onSelect,
}: {
  analysis: AnalysisResponse;
  onSelect: (selection: Selection) => void;
}) {
  const editable = analysis.graph.nodes.filter(
    (node) => node.type === 'endpoint' || node.type === 'visit',
  );
  const [nodeId, setNodeId] = useState(editable[0].id);
  const [values, setValues] = useState<Partial<Record<ScheduleField, string>>>({});
  const [result, setResult] = useState<SimulationResult | null>(null);
  const node = editable.find((item) => item.id === nodeId)!;
  const fields: ScheduleField[] =
    node.type === 'endpoint'
      ? ['required_day']
      : ['day', 'window_before_days', 'window_after_days'];
  const valid = fields.every((field) => {
    const value = values[field] ?? String(node[field] ?? 0);
    return /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
  });
  function reset() {
    setValues({});
    setResult(null);
  }
  function run() {
    if (!valid) return;
    const changes = Object.fromEntries(
      fields.map((field) => [field, Number(values[field] ?? node[field] ?? 0)]),
    );
    setResult(analysisAdapter.simulate(analysis, nodeId, changes));
    onSelect({ kind: 'node', id: nodeId });
  }
  return (
    <section className="simulation-panel">
      <div className="section-heading">
        <h2>Schedule sandbox</h2>
        <span className="muted">Preview only</span>
      </div>
      <div className="simulation-body">
        <p className="muted">
          Edit one concept at a time. Compare its schedule against the original protocol; source
          evidence and saved demo graphs stay unchanged.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run();
          }}
        >
          <label htmlFor="simulation-node">
            Concept to edit
            <select
              id="simulation-node"
              value={nodeId}
              onChange={(event) => {
                setNodeId(event.target.value);
                reset();
                onSelect({ kind: 'node', id: event.target.value });
              }}
            >
              {editable.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label || item.id}
                </option>
              ))}
            </select>
          </label>
          <div className="schedule-fields">
            {fields.map((field) => (
              <div key={field} className="schedule-field">
                <label htmlFor={`schedule-${field}`}>{labels[field]}</label>
                <input
                  id={`schedule-${field}`}
                  aria-describedby={`original-${field}`}
                  type="number"
                  min="0"
                  step="1"
                  value={values[field] ?? String(node[field] ?? 0)}
                  onChange={(event) => {
                    setValues((previous) => ({ ...previous, [field]: event.target.value }));
                    setResult(null);
                  }}
                  required
                />
                <small id={`original-${field}`}>
                  Original: <span className="mono">{String(node[field] ?? 0)}</span>
                </small>
              </div>
            ))}
          </div>
          {!valid && <p className="form-error">Enter nonnegative whole study days.</p>}
          <div className="simulation-actions">
            <button className="primary-button" type="submit" disabled={!valid}>
              Run simulation <ArrowRight size={15} />
            </button>
            <button className="secondary-button" type="button" onClick={reset}>
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </form>
        <div className="simulation-result" aria-live="polite">
          {result ? (
            <>
              <div className="section-heading">
                <h3>Comparison with original</h3>
                <span className="muted">{result.affected_nodes.length} connected concepts</span>
              </div>
              <div className="comparison-grid">
                {(
                  [
                    { key: 'new_issues', title: 'New' },
                    { key: 'resolved_issues', title: 'Resolved' },
                    { key: 'remaining_issues', title: 'Remaining' },
                  ] as const
                ).map((group) => (
                  <section key={group.key} className={group.key}>
                    <h4>
                      {group.title}
                      <span>{result[group.key].length}</span>
                    </h4>
                    {result[group.key].length ? (
                      result[group.key].map((finding) => (
                        <div className="comparison-finding" key={finding.id}>
                          <strong>{finding.title}</strong>
                          <small>
                            {finding.tier === 'verified'
                              ? 'Verified contradiction'
                              : 'Missing dependency'}
                          </small>
                        </div>
                      ))
                    ) : (
                      <p>None</p>
                    )}
                  </section>
                ))}
              </div>
              <p className="hint">
                This preview runs the two demo checks locally. No changes are persisted.
              </p>
            </>
          ) : (
            <div className="simulation-placeholder">
              <h3>Compare before you change.</h3>
              <p>Run a preview to see which findings are new, resolved, or still present.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
