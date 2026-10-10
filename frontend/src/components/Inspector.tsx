import { ArrowUpRight, BookOpen, PanelRightClose } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AnalysisResponse, Selection } from '../lib/types';
import { findingExplanation, relatedNodes } from '../lib/analysisAdapter';

interface InspectorProps { analysis: AnalysisResponse; selection: Selection; onSelect: (selection: Selection) => void; onGraph: () => void; mobileOpen: boolean; onClose: () => void }
export default function Inspector({ analysis, selection, onSelect, onGraph, mobileOpen, onClose }: InspectorProps) {
  const closeControl = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobileOpen || !window.matchMedia?.('(max-width: 1000px)').matches) return;
    const previous = document.activeElement as HTMLElement | null;
    closeControl.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [mobileOpen]);
  const { graph, findings } = analysis;
  const node = selection?.kind === 'node' ? graph.nodes.find(item => item.id === selection.id) : undefined;
  const finding = selection?.kind === 'finding' ? findings.find(item => item.id === selection.id) : undefined;
  const edge = selection?.kind === 'edge' ? graph.edges[selection.index] : undefined;
  const connected = node
    ? graph.nodes.filter(item => graph.edges.some(relation => relation.source === node.id && relation.target === item.id || relation.target === node.id && relation.source === item.id))
    : finding ? graph.nodes.filter(item => relatedNodes(finding.check_id, graph).includes(item.id))
    : edge ? graph.nodes.filter(item => [edge.source, edge.target].includes(item.id)) : [];
  const evidence = node ? [{ node_id: node.id, page: node.page, quote: node.source_text }]
    : finding?.check_id === 'missing_assessment' ? connected.map(item => ({ node_id: item.id, page: item.page, quote: item.source_text }))
    : finding?.evidence || [];
  function inspectNode(id: string) { onGraph(); onSelect({ kind: 'node', id }); }
  return <aside className={`inspector ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Evidence inspector">
    <div className="panel-heading"><h2>Source evidence</h2><button ref={closeControl} className="icon-button" aria-label="Close evidence inspector" onClick={onClose}><PanelRightClose size={17} /></button></div>
    {!selection ? <div className="inspector-prompt"><BookOpen size={22} /><h3>Select a concept</h3><p>Inspect a graph concept or review item to view its protocol passages and connections.</p></div> : <div className="inspector-content">
      <span className={`inspector-type ${finding?.tier === 'verified' ? 'red' : finding ? 'amber' : ''}`}>{node?.type || (finding ? finding.tier === 'verified' ? 'Verified contradiction' : 'Missing dependency' : 'Relationship')}</span>
      <h3>{node?.label || node?.id || finding?.title || edge?.type.replaceAll('_', ' ').toLowerCase()}</h3>
      {node && <code>{node.id}</code>}
      {finding && <><p className="finding-explanation">{findingExplanation(finding.check_id)}</p><button className="text-button" onClick={onGraph}>Locate in graph <ArrowUpRight size={14} /></button></>}
      <section className="evidence-section"><h4><BookOpen size={14} /> Protocol passages</h4>{evidence.some(item => item.quote) ? evidence.filter(item => item.quote).map(item => <blockquote key={item.node_id}><div className="quote-heading"><span>Protocol · Page {item.page ?? 'unspecified'}</span>{!node && <button aria-label={`Inspect ${graph.nodes.find(n => n.id === item.node_id)?.label || item.node_id}`} className="icon-button" onClick={() => inspectNode(item.node_id)}><ArrowUpRight size={14} /></button>}</div><p>“{item.quote}”</p></blockquote>) : <p className="muted">No passage is attached to this relationship. Inspect its connected concepts for source evidence.</p>}</section>
      {node && <section><h4>Concept details</h4><dl>{(['field', 'value', 'required_day', 'day', 'window_before_days', 'window_after_days', 'description'] as const).filter(key => node[key] != null).map(key => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd className={key === 'description' ? '' : 'mono'}>{String(node[key])}</dd></div>)}</dl></section>}
      {connected.length > 0 && <section><h4>{finding ? 'Affected concepts' : 'Connected concepts'}</h4>{connected.map(item => <button className="connected-node" key={item.id} onClick={() => inspectNode(item.id)}><span><strong>{item.label || item.id}</strong><small>{item.type}</small></span><ArrowUpRight size={13} /></button>)}</section>}
      <button className="text-button clear-selection" onClick={() => onSelect(null)}>Clear selection</button>
    </div>}
  </aside>;
}
