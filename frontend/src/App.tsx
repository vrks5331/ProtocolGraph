import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileText,
  GitBranch,
  History,
  LayoutDashboard,
  List,
  LoaderCircle,
  Network,
  Share2,
  SlidersHorizontal,
  Upload,
  Workflow,
} from 'lucide-react';
import { API_BASE_URL, ApiError, formatDate, getAnalysis, listHistory, pdfUrl } from './lib/api';
import { TYPE_COLORS, edgeId, fuzzyMatchedNodes, humanize, relatedNodes } from './lib/graphUtils';
import type { AnalysisResponse, AnalysisSummary, NodeType, Selection } from './lib/types';
import ProtocolCanvas, { type GraphLayout } from './components/ProtocolCanvas';
import Findings from './components/Findings';
import Inspector from './components/Inspector';
import UploadDialog from './components/UploadDialog';
import HistoryPanel from './components/HistoryPanel';

type View = 'Overview' | 'Graph Explorer' | 'Simulate' | 'History';
const navigation = [
  { title: 'Overview', icon: LayoutDashboard },
  { title: 'Graph Explorer', icon: Network },
  { title: 'Simulate', icon: SlidersHorizontal },
  { title: 'History', icon: History },
] as const;
const headings: Record<View, [string, string]> = {
  Overview: ['Protocol review', 'Review inconsistencies and trace each concept to its source.'],
  'Graph Explorer': ['Graph explorer', 'Explore extracted concepts and how they connect.'],
  Simulate: ['Schedule simulation', 'Test schedule changes against the consistency checks.'],
  History: ['Protocol library', 'Every analyzed protocol is saved here.'],
};

const LAYOUT_KEY = 'protocolgraph.graphLayout';

function readHash(): string | null {
  const match = window.location.hash.match(/^#\/analysis\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export default function App() {
  const [view, setView] = useState<View>('Overview');
  const [analysisId, setAnalysisId] = useState<string | null>(readHash);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<AnalysisSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [listMode, setListMode] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [graphLayout, setGraphLayout] = useState<GraphLayout>(() =>
    localStorage.getItem(LAYOUT_KEY) === 'flow' ? 'flow' : 'web',
  );
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(await listHistory());
    } catch (error) {
      setHistoryError(errorText(error));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    const onHashChange = () => setAnalysisId(readHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!analysisId) {
      setAnalysis(null);
      setLoading(false);
      setLoadError(null);
      return;
    }
    if (analysisRef.current?.analysis_id === analysisId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getAnalysis(analysisId)
      .then((loaded) => {
        if (cancelled) return;
        setLoading(false);
        setAnalysis(loaded);
        setSelection(null);
        setFocusRequest(0);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoading(false);
        setAnalysis(null);
        setLoadError(
          error instanceof ApiError && error.status === 404
            ? 'This analysis no longer exists. Open another one from History or upload a protocol.'
            : errorText(error),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !uploadOpen) setSelection(null);
    }
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [uploadOpen]);

  const selectedFinding =
    analysis && selection?.kind === 'finding'
      ? analysis.findings.find((f) => f.id === selection.id)
      : undefined;
  const highlighted = useMemo(
    () => (analysis && selectedFinding ? relatedNodes(selectedFinding, analysis.graph) : []),
    [selectedFinding, analysis],
  );
  const fuzzy = useMemo(() => fuzzyMatchedNodes(analysis?.extraction_issues), [analysis]);

  function openAnalysis(id: string) {
    window.location.hash = `#/analysis/${encodeURIComponent(id)}`;
    setAnalysisId(id);
    setView('Overview');
  }
  function handleUploaded(result: AnalysisResponse) {
    setAnalysis(result);
    setSelection(null);
    setFocusRequest(0);
    setLoadError(null);
    window.location.hash = `#/analysis/${encodeURIComponent(result.analysis_id)}`;
    setAnalysisId(result.analysis_id);
    setView('Graph Explorer');
    setUploadOpen(false);
    void refreshHistory();
  }
  const select = setSelection;
  function chooseLayout(next: GraphLayout) {
    setGraphLayout(next);
    localStorage.setItem(LAYOUT_KEY, next);
  }
  function selectFinding(next: Selection) {
    select(next);
    if (next?.kind === 'finding') {
      setView('Graph Explorer');
      setFocusRequest((value) => value + 1);
    }
  }
  function navigate(next: View) {
    setView(next);
    setSelection(null);
  }

  const reviewView = view === 'Overview' || view === 'Graph Explorer';
  const showInspector = reviewView && analysis !== null && selection !== null;
  const issues = analysis?.extraction_issues ?? [];
  const droppedCount = issues.filter((issue) => issue.action.startsWith('dropped')).length;
  const [title, subtitle] = headings[view];
  const nodesById = new Map(analysis?.graph.nodes.map((node) => [node.id, node]));

  function renderReview() {
    if (loading) {
      return (
        <section className="panel state-panel">
          <p className="muted loading-line" role="status">
            <LoaderCircle size={15} className="spin" /> Loading analysis…
          </p>
        </section>
      );
    }
    if (loadError) {
      return (
        <section className="panel state-panel">
          <div className="empty-state error">
            <CircleAlert size={20} />
            <div>
              <strong>Could not open this analysis</strong>
              <p>{loadError}</p>
              <button className="text-button" onClick={() => navigate('History')}>
                Open history
              </button>
            </div>
          </div>
        </section>
      );
    }
    if (!analysis) {
      return (
        <section className="panel state-panel welcome">
          <FileText size={26} className="upload-symbol" />
          <h2>Upload a protocol to get started</h2>
          <p className="muted">
            ProtocolGraph extracts objectives, endpoints, procedures, visits, eligibility criteria
            and analyses from a protocol PDF, maps how they connect, and flags inconsistencies.
          </p>
          <div className="welcome-actions">
            <button className="primary-button" onClick={() => setUploadOpen(true)}>
              <Upload size={15} /> Upload protocol
            </button>
            {history.length > 0 && (
              <button className="secondary-button" onClick={() => navigate('History')}>
                <History size={15} /> Open a previous analysis
              </button>
            )}
          </div>
        </section>
      );
    }
    const { graph, findings } = analysis;
    const presentTypes = (Object.keys(TYPE_COLORS) as NodeType[]).filter((type) =>
      graph.nodes.some((node) => node.type === type),
    );
    return (
      <>
        <section className="panel graph-panel" aria-label="Protocol map">
          <div className="panel-heading">
            <div>
              <h2>Protocol map</h2>
              <p>Extracted concepts and relationships</p>
            </div>
            <div className="panel-actions">
              {!listMode && (
                <div className="segmented" role="group" aria-label="Graph layout">
                  {(
                    [
                      ['web', 'Web', Share2],
                      ['flow', 'Flow', Workflow],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <button
                      key={value}
                      aria-pressed={graphLayout === value}
                      className={graphLayout === value ? 'active' : ''}
                      onClick={() => chooseLayout(value)}
                    >
                      <Icon size={14} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                className="secondary-button view-toggle"
                onClick={() => setListMode(!listMode)}
                aria-pressed={listMode}
              >
                {listMode ? <Network size={15} /> : <List size={15} />}
                <span>{listMode ? 'Graph view' : 'Text view'}</span>
              </button>
            </div>
          </div>
          <div className={listMode ? 'canvas-container hidden' : 'canvas-container'}>
            <ProtocolCanvas
              graph={graph}
              layout={graphLayout}
              selection={selection}
              highlighted={highlighted}
              fuzzy={fuzzy}
              focusRequest={focusRequest}
              onSelect={select}
            />
          </div>
          <div className={`concept-list ${listMode ? 'show-list' : ''}`}>
            <h3>Concepts</h3>
            {graph.nodes.map((node) => (
              <button
                key={node.id}
                className={highlighted.includes(node.id) ? 'highlighted' : ''}
                onClick={() => select({ kind: 'node', id: node.id })}
              >
                <span className="eyebrow">{node.type}</span>
                <strong>{node.label || node.id}</strong>
                <small>Page {node.page ?? 'unspecified'}</small>
              </button>
            ))}
            <h3>Relationships</h3>
            {graph.edges.map((edge) => (
              <button key={edgeId(edge)} onClick={() => select({ kind: 'edge', id: edgeId(edge) })}>
                {nodesById.get(edge.source)?.label || edge.source}
                <span className="eyebrow">{humanize(edge.type)}</span>
                {nodesById.get(edge.target)?.label || edge.target}
              </button>
            ))}
          </div>
          <div className="graph-footer">
            {presentTypes.map((type) => (
              <span key={type}>
                <i className="type-dot" style={{ background: TYPE_COLORS[type] }} /> {type}
              </span>
            ))}
            <span>
              <i className="highlight-key" /> Finding context
            </span>
            {fuzzy.size > 0 && (
              <span>
                <i className="fuzzy-key" /> Approximate source match
              </span>
            )}
            <span className="graph-help">
              Hover for details · Click to inspect · Scroll to zoom
            </span>
          </div>
        </section>
        <section className="findings-panel" aria-label="Findings review queue">
          <div className="section-heading">
            <h2>
              Review queue <span className="count">{findings.length}</span>
            </h2>
          </div>
          <Findings
            graph={graph}
            findings={findings}
            selection={selection}
            onSelect={selectFinding}
          />
        </section>
      </>
    );
  }

  return (
    <div className="workspace">
      <nav className="sidebar" aria-label="Primary navigation">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setView('Overview');
          }}
        >
          <span className="brand-mark">
            <GitBranch size={21} />
          </span>
          <span>
            Protocol<span className="brand-light">Graph</span>
          </span>
        </a>
        <span className="nav-label">Workspace</span>
        <div className="nav-items">
          {navigation.map(({ title: item, icon: Icon }) => (
            <button
              key={item}
              aria-current={view === item ? 'page' : undefined}
              className={view === item ? 'active' : ''}
              onClick={() => navigate(item)}
            >
              <Icon size={17} />
              <span>{item}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <span className={`demo-dot ${historyError ? 'offline' : ''}`} />
          <div>
            <strong>{historyError ? 'Backend unreachable' : 'Local workspace'}</strong>
            <small>{API_BASE_URL.replace(/^https?:\/\//, '')}</small>
          </div>
        </div>
      </nav>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Protocol review</span>
            <span className="slash">/</span>
            <strong>{analysis?.filename || (loading ? 'Loading…' : 'No protocol open')}</strong>
            <span className="slash">/</span>
            <span>{view}</span>
          </div>
          <button className="primary-button upload-button" onClick={() => setUploadOpen(true)}>
            <Upload size={15} /> Upload protocol
          </button>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            {analysis && view !== 'History' && (
              <div className="analysis-meta">
                <strong title={analysis.filename ?? undefined}>
                  {analysis.filename || 'Uploaded protocol'}
                </strong>
                <small>
                  {analysis.created_at ? `Analyzed ${formatDate(analysis.created_at)} · ` : ''}
                  <a href={pdfUrl(analysis.analysis_id)} target="_blank" rel="noreferrer">
                    Open PDF <ExternalLink size={11} />
                  </a>
                </small>
              </div>
            )}
          </div>
          {analysis && reviewView && (
            <div className="summary-strip" aria-live="polite">
              <div className={`status ${analysis.findings.length ? 'needs-review' : ''}`}>
                {analysis.findings.length ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}
                <strong>
                  {analysis.findings.length ? 'Review needed' : 'No issues found by the checks'}
                </strong>
              </div>
              <span>
                <b>{analysis.graph.nodes.length}</b> concepts
              </span>
              <span>
                <b>{analysis.graph.edges.length}</b> relationships
              </span>
              <span>
                <b>{analysis.findings.length}</b> findings
              </span>
              {issues.length > 0 && (
                <span title="Adjustments made while validating the extraction">
                  <b>{fuzzy.size}</b> approximate quotes · <b>{droppedCount}</b> dropped items
                </span>
              )}
              <span className="summary-scope">Automated checks · verify against the protocol</span>
            </div>
          )}
          <div className={`review-layout ${showInspector ? '' : 'inspector-collapsed'}`}>
            <div className="review-main">
              {view === 'History' ? (
                <HistoryPanel
                  analyses={history}
                  loading={historyLoading}
                  error={historyError}
                  currentId={analysis?.analysis_id ?? null}
                  onOpen={openAnalysis}
                  onRetry={() => void refreshHistory()}
                  onUpload={() => setUploadOpen(true)}
                />
              ) : view === 'Simulate' ? (
                <section className="panel state-panel" aria-label="Schedule simulation">
                  <div className="simulation-placeholder">
                    <SlidersHorizontal size={22} className="upload-symbol" />
                    <h3>Schedule simulation is coming soon</h3>
                    <p>
                      You will be able to change a visit or endpoint schedule and see which findings
                      it creates or resolves before editing the protocol.
                    </p>
                  </div>
                </section>
              ) : (
                renderReview()
              )}
            </div>
            {showInspector && (
              <Inspector
                analysis={analysis}
                selection={selection}
                onSelect={select}
                onGraph={() => setView('Graph Explorer')}
                mobileOpen
                onClose={() => setSelection(null)}
              />
            )}
          </div>
          <footer className="workspace-note">
            Concepts are extracted automatically and checked for two kinds of issues: conflicting
            eligibility values and endpoints without a matching scheduled assessment. This is not
            comprehensive clinical validation; verify findings against the source protocol.
          </footer>
        </main>
      </div>
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={handleUploaded}
      />
    </div>
  );
}
