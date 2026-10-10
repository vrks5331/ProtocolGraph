import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, GitBranch, History, LayoutDashboard, List, Network, PanelRightClose, PanelRightOpen, SlidersHorizontal, Upload, X } from 'lucide-react';
import { analysisAdapter, demoAnalyses, relatedNodes } from './lib/analysisAdapter';
import type { DatasetId, Selection } from './lib/types';
import ProtocolCanvas from './components/ProtocolCanvas';
import Findings from './components/Findings';
import Inspector from './components/Inspector';
import Simulation from './components/Simulation';

type View = 'Overview' | 'Graph Explorer' | 'Simulate' | 'History';
const navigation = [
  { title: 'Overview', icon: LayoutDashboard }, { title: 'Graph Explorer', icon: Network },
  { title: 'Simulate', icon: SlidersHorizontal }, { title: 'History', icon: History },
] as const;
function defaultSelection(id: DatasetId): Selection {
  return id === 'injected' ? { kind: 'finding', id: 'eligibility_conflict:minimum_age' } : { kind: 'node', id: 'endpoint_response' };
}

export default function App() {
  const [dataset, setDataset] = useState<DatasetId>('injected');
  const [view, setView] = useState<View>('Overview');
  const [selection, setSelection] = useState<Selection>(defaultSelection('injected'));
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [listMode, setListMode] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const analysis = useMemo(() => analysisAdapter.getAnalysis(dataset), [dataset]);
  const selectedFinding = selection?.kind === 'finding' ? analysis.findings.find(f => f.id === selection.id) : undefined;
  const highlighted = useMemo(() => selectedFinding ? relatedNodes(selectedFinding.check_id, analysis.graph) : [], [selectedFinding, analysis.graph]);
  useEffect(() => { if (uploadOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [uploadOpen]);
  useEffect(() => {
    function onEscape(event: KeyboardEvent) { if (event.key === 'Escape' && !uploadOpen) setMobileInspectorOpen(false); }
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [uploadOpen]);
  function switchDataset(id: DatasetId) { setDataset(id); setSelection(defaultSelection(id)); setMobileInspectorOpen(false); setFocusRequest(0); }
  function select(next: Selection) { setSelection(next); if (next) { setInspectorOpen(true); setMobileInspectorOpen(true); } }
  function selectFinding(next: Selection) { select(next); if (next?.kind === 'finding') { setView('Graph Explorer'); setFocusRequest(value => value + 1); } }
  function toggleInspector() { setInspectorOpen(open => !open); setMobileInspectorOpen(open => !open); }
  function navigate(next: View) { setView(next); setMobileInspectorOpen(false); if (next === 'Simulate') setSelection({ kind: 'node', id: 'endpoint_response' }); }
  const showGraph = () => setView('Graph Explorer');
  const protocolName = demoAnalyses.find(item => item.id === dataset)!.name;

  return <div className="workspace">
    <nav className="sidebar" aria-label="Primary navigation">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setView('Overview'); }}>
        <span className="brand-mark"><GitBranch size={21} /></span><span>Protocol<span className="brand-light">Graph</span></span>
      </a>
      <span className="nav-label">Workspace</span>
      <div className="nav-items">{navigation.map(({ title, icon: Icon }) => <button key={title} aria-current={view === title ? 'page' : undefined} className={view === title ? 'active' : ''} onClick={() => navigate(title)}><Icon size={17} /><span>{title}</span></button>)}</div>
      <div className="sidebar-footer"><span className="demo-dot" /><div><strong>Sample workspace</strong><small>Local session · No uploads</small></div></div>
    </nav>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><span>Protocol review</span><span className="slash">/</span><strong>{protocolName}</strong><span className="slash">/</span><span>{view}</span></div><button className="primary-button upload-button" onClick={() => setUploadOpen(true)}><Upload size={15} /> Upload protocol</button></header>
      <main>
        <div className="page-heading"><div><h1>{view === 'Simulate' ? 'Schedule simulation' : view === 'History' ? 'Protocol library' : view === 'Graph Explorer' ? 'Graph explorer' : 'Protocol review'}</h1><p>{view === 'Simulate' ? 'Test a schedule change and compare consistency findings.' : view === 'History' ? 'Two source datasets available for this sample workspace.' : 'Review inconsistencies and trace each concept to its source.'}</p></div>
          <div className="dataset-control"><label htmlFor="dataset">Protocol dataset</label><select id="dataset" value={dataset} onChange={event => switchDataset(event.target.value as DatasetId)}>{demoAnalyses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        </div>
        <div className="summary-strip" aria-live="polite"><div className={`status ${analysis.findings.length ? 'needs-review' : ''}`}>{analysis.findings.length ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}<strong>{analysis.findings.length ? 'Review needed' : 'Consistent in demo checks'}</strong></div><span><b>{analysis.graph.nodes.length}</b> concepts</span><span><b>{analysis.graph.edges.length}</b> relationships</span><span><b>{analysis.findings.length}</b> findings</span><span className="summary-scope">Limited demo checks</span></div>
        <div className={`review-layout ${!inspectorOpen || view === 'History' ? 'inspector-collapsed' : ''}`}>
          <div className="review-main">
            {view === 'History' ? <section className="history-panel"><div className="section-heading"><h2>Demo history</h2><span className="muted">Sample datasets</span></div><p className="muted history-description">These samples are available locally. Uploaded protocols and persistent analysis history will be connected during integration.</p>{analysisAdapter.listAnalyses().map(item => <button className="history-row" key={item.id} onClick={() => { switchDataset(item.id); setView('Overview'); }}><Network size={19} /><span><strong>{item.name}</strong><small>{item.description}</small></span><ArrowRight size={16} /></button>)}</section>
              : view === 'Simulate' ? <Simulation key={dataset} analysis={analysis} onSelect={select} />
              : <>
                <section className="panel graph-panel" aria-label="Protocol map"><div className="panel-heading"><div><h2>Protocol map</h2><p>Eligibility criteria & assessment pathway</p></div><div className="panel-actions"><button className="secondary-button view-toggle" onClick={() => setListMode(!listMode)} aria-pressed={listMode}>{listMode ? <Network size={15} /> : <List size={15} />}<span>{listMode ? 'Graph view' : 'Text view'}</span></button><button className="icon-button inspector-toggle desktop-inspector-toggle" aria-label={inspectorOpen ? 'Collapse evidence inspector' : 'Expand evidence inspector'} aria-expanded={inspectorOpen} onClick={toggleInspector}>{inspectorOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button><button className="icon-button mobile-inspector-toggle" aria-label="Open evidence inspector" onClick={() => { setInspectorOpen(true); setMobileInspectorOpen(true); }}><PanelRightOpen size={18} /></button></div></div>
                  <div className={listMode ? 'canvas-container hidden' : 'canvas-container'}><ProtocolCanvas graph={analysis.graph} selection={selection} highlighted={highlighted} focusRequest={focusRequest} onSelect={select} /></div>
                  <div className={`concept-list ${listMode ? 'show-list' : ''}`}><h3>Concepts</h3>{analysis.graph.nodes.map(node => <button key={node.id} className={highlighted.includes(node.id) ? 'highlighted' : ''} onClick={() => select({ kind: 'node', id: node.id })}><span className="eyebrow">{node.type}</span><strong>{node.label || node.id}</strong><small>Page {node.page ?? 'unspecified'}</small></button>)}<h3>Relationships</h3>{analysis.graph.edges.map((edge, index) => <button key={index} onClick={() => select({ kind: 'edge', index })}>{analysis.graph.nodes.find(node => node.id === edge.source)?.label}<span className="eyebrow">{edge.type.replaceAll('_', ' ')}</span>{analysis.graph.nodes.find(node => node.id === edge.target)?.label}</button>)}</div>
                  <div className="graph-footer"><span><i /> Concept</span><span><i className="highlight-key" /> Finding context</span><span className="graph-help">Drag to pan · Select to inspect</span></div>
                </section>
                <section className="findings-panel" aria-label="Findings review queue"><div className="section-heading"><h2>Review queue <span className="count">{analysis.findings.length}</span></h2><button className="text-button" onClick={() => navigate('Simulate')}>Test a schedule change <ArrowRight size={14} /></button></div><Findings graph={analysis.graph} findings={analysis.findings} selection={selection} onSelect={selectFinding} /></section>
              </>}
          </div>
          {view !== 'History' && inspectorOpen && <Inspector analysis={analysis} selection={selection} onSelect={select} onGraph={showGraph} mobileOpen={mobileInspectorOpen} onClose={() => { setInspectorOpen(false); setMobileInspectorOpen(false); }} />}
        </div>
        {view === 'Simulate' && !inspectorOpen && <button className="text-button" onClick={toggleInspector}><PanelRightOpen size={15} /> Open source evidence</button>}
        <footer className="workspace-note">Sample data · Two limited consistency checks, not comprehensive clinical validation. Changes are local and are not persisted.</footer>
      </main>
    </div>
    <dialog ref={dialog} onCancel={() => setUploadOpen(false)} onClose={() => setUploadOpen(false)} aria-labelledby="upload-title"><div className="modal"><button className="icon-button modal-close" aria-label="Close upload information" onClick={() => setUploadOpen(false)}><X size={18} /></button><Upload className="upload-symbol" size={25} /><h2 id="upload-title">Upload a protocol</h2><p>PDF ingestion will be connected during integration. This workspace currently uses sample datasets; no files are uploaded or processed.</p><button className="primary-button" onClick={() => setUploadOpen(false)}>Continue with demo data <ArrowRight size={15} /></button></div></dialog>
  </div>;
}
