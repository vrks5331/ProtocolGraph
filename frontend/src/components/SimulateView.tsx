import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  CircleAlert,
  Copy,
  FlaskConical,
  LoaderCircle,
  Plus,
  Share2,
  Workflow,
} from 'lucide-react';
import { ApiError, analyzeScenario, getScenario, listScenarios, saveScenario } from '../lib/api';
import { applyEdits, editedIds, editsReducer } from '../lib/edits';
import { TYPE_COLORS, neighborhood, relatedNodes } from '../lib/graphUtils';
import type {
  AnalysisResponse,
  NodeType,
  ScenarioResponse,
  ScenarioSummary,
  Selection,
} from '../lib/types';
import ProtocolCanvas, { EDITED_COLOR, type GraphLayout } from './ProtocolCanvas';
import ScenarioEditor from './ScenarioEditor';
import ScenarioResults from './ScenarioResults';

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export default function SimulateView({
  analysis,
  scenarioId,
  layout,
  onLayout,
  onOpenScenario,
  onScenariosChanged,
}: {
  analysis: AnalysisResponse;
  scenarioId: string | null;
  layout: GraphLayout;
  onLayout: (layout: GraphLayout) => void;
  onOpenScenario: (scenarioId: string | null) => void;
  onScenariosChanged: () => void;
}) {
  const analysisId = analysis.analysis_id;
  const [draft, dispatch] = useReducer(editsReducer, []);
  const [scenario, setScenario] = useState<ScenarioResponse | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;
  const resultsRef = useRef<HTMLElement>(null);
  const [scrollRequest, setScrollRequest] = useState(0);

  useEffect(() => {
    if (scrollRequest === 0) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    resultsRef.current?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, [scrollRequest]);

  useEffect(() => {
    let cancelled = false;
    listScenarios(analysisId)
      .then((items) => !cancelled && setScenarios(items))
      .catch(() => !cancelled && setScenarios([]));
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  useEffect(() => {
    setAnalyzeError(null);
    if (!scenarioId) {
      setScenario(null);
      setScenarioError(null);
      return;
    }
    if (scenarioRef.current?.scenario_id === scenarioId) return;
    let cancelled = false;
    setScenarioError(null);
    getScenario(scenarioId)
      .then((loaded) => {
        if (cancelled) return;
        if (loaded.analysis_id !== analysisId) {
          setScenarioError('This scenario belongs to a different analysis.');
          return;
        }
        setScenario(loaded);
        setSelection(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setScenario(null);
        setScenarioError(
          error instanceof ApiError && error.status === 404
            ? 'This scenario no longer exists.'
            : errorText(error, 'Could not load this scenario.'),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [scenarioId, analysisId]);

  const locked = scenario !== null;
  const edits = scenario?.edits ?? draft;
  const graph = useMemo(
    () => scenario?.graph ?? applyEdits(analysis.graph, edits),
    [scenario, analysis.graph, edits],
  );
  const edited = useMemo(() => editedIds(edits), [edits]);
  const fuzzy = useMemo(() => new Set<string>(), []);
  const analyzed = scenario?.status === 'analyzed' ? scenario : null;
  const selectedFinding =
    analyzed && selection?.kind === 'finding'
      ? [
          ...(analyzed.resolved_issues ?? []),
          ...(analyzed.new_issues ?? []),
          ...(analyzed.remaining_issues ?? []),
        ].find((finding) => finding.id === selection.id)
      : undefined;
  const highlighted = useMemo(() => {
    if (selectedFinding) return relatedNodes(selectedFinding, graph);
    if (selection?.kind === 'node' || selection?.kind === 'edge') {
      return neighborhood(graph, selection);
    }
    return analyzed ? (analyzed.affected_nodes ?? []) : [];
  }, [selectedFinding, analyzed, graph, selection]);

  function select(next: Selection) {
    setSelection(next);
    if (next?.kind === 'node' || next?.kind === 'edge') {
      setFocusRequest((value) => value + 1);
    }
  }
  const presentTypes = (Object.keys(TYPE_COLORS) as NodeType[]).filter((type) =>
    graph.nodes.some((node) => node.type === type),
  );

  async function save(name: string) {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveScenario(analysisId, name, draft);
      setScenario(saved);
      dispatch({ type: 'clear' });
      setScenarios((items) => [
        { ...saved, edit_count: saved.edits.length },
        ...items.filter((item) => item.scenario_id !== saved.scenario_id),
      ]);
      onOpenScenario(saved.scenario_id);
      onScenariosChanged();
      return true;
    } catch (error) {
      setSaveError(
        error instanceof ApiError && error.status === 409
          ? `The original analysis no longer matches these edits: ${error.message}`
          : errorText(error, 'Could not save the scenario. Try again.'),
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function analyze() {
    if (!scenario) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const result = await analyzeScenario(scenario.scenario_id);
      setScenario(result);
      setScrollRequest((value) => value + 1);
      setScenarios((items) =>
        items.map((item) =>
          item.scenario_id === result.scenario_id ? { ...item, status: result.status } : item,
        ),
      );
    } catch (error) {
      setAnalyzeError(errorText(error, 'Could not analyze the scenario. Try again.'));
    } finally {
      setAnalyzing(false);
    }
  }

  function startNew() {
    dispatch({ type: 'clear' });
    setSelection(null);
    onOpenScenario(null);
  }

  function duplicate() {
    if (!scenario) return;
    dispatch({ type: 'load', edits: scenario.edits });
    setSelection(null);
    onOpenScenario(null);
  }

  return (
    <div className="simulate">
      <div className="scenario-banner" role="note">
        <FlaskConical size={16} />
        <p>
          Scenario based on <strong>{analysis.filename || 'this protocol'}</strong>. Changes never
          affect the original analysis.
        </p>
      </div>
      <div className="scenario-toolbar">
        <label className="scenario-picker">
          <span>Saved scenarios</span>
          <select
            value={scenario?.scenario_id ?? ''}
            onChange={(event) => {
              setSelection(null);
              onOpenScenario(event.target.value || null);
            }}
          >
            <option value="">
              {draft.length ? `Unsaved draft (${draft.length})` : 'New scenario'}
            </option>
            {scenarios.map((item) => (
              <option key={item.scenario_id} value={item.scenario_id}>
                {item.name} · {item.edit_count} {item.edit_count === 1 ? 'edit' : 'edits'}
                {item.status === 'analyzed' ? ' · analyzed' : ''}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button" onClick={startNew}>
          <Plus size={14} /> New
        </button>
        <button className="secondary-button" onClick={duplicate} disabled={!scenario}>
          <Copy size={14} /> Duplicate
        </button>
      </div>
      {scenarioError && (
        <div className="empty-state error" role="alert">
          <CircleAlert size={20} />
          <div>
            <strong>Could not open this scenario</strong>
            <p>{scenarioError}</p>
            <button className="text-button" onClick={startNew}>
              Start a new scenario
            </button>
          </div>
        </div>
      )}
      {scenarioId && !scenario && !scenarioError ? (
        <p className="muted loading-line" role="status">
          <LoaderCircle size={15} className="spin" /> Loading scenario…
        </p>
      ) : (
        <div className="simulate-layout">
          <div className="simulate-main">
            <section className="panel graph-panel" aria-label="Scenario map">
              <div className="panel-heading">
                <div>
                  <h2>{scenario ? scenario.name : 'Draft scenario'}</h2>
                  <p>
                    {locked
                      ? 'Saved edits are read-only. Duplicate the scenario to change them.'
                      : 'Click a concept or relationship to change its details.'}
                  </p>
                </div>
                <div className="segmented" role="group" aria-label="Graph layout">
                  {(
                    [
                      ['web', 'Web', Share2],
                      ['flow', 'Flow', Workflow],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <button
                      key={value}
                      aria-pressed={layout === value}
                      className={layout === value ? 'active' : ''}
                      onClick={() => onLayout(value)}
                    >
                      <Icon size={14} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="canvas-container">
                <ProtocolCanvas
                  graph={graph}
                  layout={layout}
                  selection={selection}
                  highlighted={highlighted}
                  fuzzy={fuzzy}
                  edited={edited}
                  focusRequest={focusRequest}
                  onSelect={select}
                />
              </div>
              <div className="graph-footer">
                {presentTypes.map((type) => (
                  <span key={type}>
                    <i className="type-dot" style={{ background: TYPE_COLORS[type] }} /> {type}
                  </span>
                ))}
                <span>
                  <i className="edited-key" style={{ borderColor: EDITED_COLOR }} /> Edited
                </span>
                {analyzed && (
                  <span>
                    <i className="highlight-key" /> Affected by the edits
                  </span>
                )}
                <span className="graph-help">
                  Hover for details · Click to edit · Scroll to zoom
                </span>
              </div>
            </section>
            {analyzed && (
              <ScenarioResults
                ref={resultsRef}
                scenario={analyzed}
                baseGraph={analysis.graph}
                selection={selection}
                onSelect={select}
              />
            )}
          </div>
          <ScenarioEditor
            analysisId={analysisId}
            baseGraph={analysis.graph}
            graph={graph}
            edits={edits}
            dispatch={dispatch}
            selection={selection}
            onSelect={select}
            scenario={scenario}
            saving={saving}
            saveError={saveError}
            onSave={save}
            analyzing={analyzing}
            analyzeError={analyzeError}
            onAnalyze={() => void analyze()}
            onShowResults={() => setScrollRequest((value) => value + 1)}
            suggestedName={`Scenario ${scenarios.length + 1}`}
          />
        </div>
      )}
    </div>
  );
}
