import { useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileText,
  FlaskConical,
  LoaderCircle,
  RotateCw,
  Upload,
} from 'lucide-react';
import { formatDate, listScenarios } from '../lib/api';
import type { AnalysisSummary, ScenarioSummary } from '../lib/types';

type ScenarioList = ScenarioSummary[] | 'loading' | 'error';

export default function HistoryPanel({
  analyses,
  loading,
  error,
  currentId,
  onOpen,
  onOpenScenario,
  onRetry,
  onUpload,
}: {
  analyses: AnalysisSummary[];
  loading: boolean;
  error: string | null;
  currentId: string | null;
  onOpen: (analysisId: string) => void;
  onOpenScenario: (analysisId: string, scenarioId: string) => void;
  onRetry: () => void;
  onUpload: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, ScenarioList>>({});

  async function toggle(analysisId: string) {
    if (expanded[analysisId]) {
      setExpanded(({ [analysisId]: _, ...rest }) => rest);
      return;
    }
    setExpanded((state) => ({ ...state, [analysisId]: 'loading' }));
    try {
      const scenarios = await listScenarios(analysisId);
      setExpanded((state) => ({ ...state, [analysisId]: scenarios }));
    } catch {
      setExpanded((state) => ({ ...state, [analysisId]: 'error' }));
    }
  }

  function renderScenarios(item: AnalysisSummary) {
    const scenarios = expanded[item.analysis_id];
    if (!scenarios) return null;
    if (scenarios === 'loading') {
      return (
        <p className="muted loading-line scenario-list" role="status">
          <LoaderCircle size={13} className="spin" /> Loading scenarios…
        </p>
      );
    }
    if (scenarios === 'error') {
      return <p className="form-error scenario-list">Could not load scenarios.</p>;
    }
    return (
      <ul className="scenario-list" aria-label={`Scenarios for ${item.filename}`}>
        {scenarios.map((scenario) => (
          <li key={scenario.scenario_id}>
            <button onClick={() => onOpenScenario(item.analysis_id, scenario.scenario_id)}>
              <FlaskConical size={14} />
              <span>
                <strong>{scenario.name}</strong>
                <small>
                  {scenario.edit_count} {scenario.edit_count === 1 ? 'edit' : 'edits'} ·{' '}
                  {scenario.status === 'analyzed' ? 'Analyzed' : 'Saved'} ·{' '}
                  {formatDate(scenario.created_at)}
                </small>
              </span>
              <ArrowRight size={14} />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="history-panel" aria-label="Analysis history">
      <div className="section-heading">
        <h2>
          Analyzed protocols <span className="count">{analyses.length}</span>
        </h2>
        <button className="text-button" onClick={onRetry} disabled={loading}>
          <RotateCw size={13} /> Refresh
        </button>
      </div>
      {error ? (
        <div className="empty-state error">
          <CircleAlert size={20} />
          <div>
            <strong>Could not load history</strong>
            <p>{error}</p>
            <button className="text-button" onClick={onRetry}>
              Try again
            </button>
          </div>
        </div>
      ) : loading && !analyses.length ? (
        <p className="muted loading-line" role="status">
          <LoaderCircle size={15} className="spin" /> Loading history…
        </p>
      ) : !analyses.length ? (
        <div className="empty-state">
          <FileText size={20} />
          <div>
            <strong>No protocols analyzed yet</strong>
            <p>Uploaded protocols appear here so you can reopen them later.</p>
            <button className="text-button" onClick={onUpload}>
              <Upload size={13} /> Upload a protocol
            </button>
          </div>
        </div>
      ) : (
        analyses.map((item) => {
          const count = item.scenario_count ?? 0;
          const open = Boolean(expanded[item.analysis_id]);
          return (
            <div className="history-item" key={item.analysis_id}>
              <button
                className={`history-row ${item.analysis_id === currentId ? 'current' : ''}`}
                aria-current={item.analysis_id === currentId ? 'true' : undefined}
                onClick={() => onOpen(item.analysis_id)}
              >
                <FileText size={19} />
                <span>
                  <strong>{item.filename}</strong>
                  <small>
                    Analyzed {formatDate(item.created_at)}
                    {item.analysis_id === currentId ? ' · Currently open' : ''}
                  </small>
                </span>
                <ArrowRight size={16} />
              </button>
              {count > 0 && (
                <button
                  className="text-button scenario-toggle"
                  aria-expanded={open}
                  onClick={() => void toggle(item.analysis_id)}
                >
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  {count} {count === 1 ? 'scenario' : 'scenarios'}
                </button>
              )}
              {renderScenarios(item)}
            </div>
          );
        })
      )}
    </section>
  );
}
