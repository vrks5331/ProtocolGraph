import { useEffect, useMemo } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position, MarkerType, useReactFlow, useNodesState, type NodeProps, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Concept, GraphPayload, Selection } from '../lib/types';

type ConceptNode = Node<{ concept: Concept; highlighted: boolean }, 'concept'>;
function ConceptCard({ data, selected }: NodeProps<ConceptNode>) {
  const n = data.concept;
  return <div className={`concept-card type-${n.type} ${selected ? 'selected' : ''} ${data.highlighted ? 'highlighted' : ''}`}>
    <Handle type="target" position={Position.Left} />
    <span className="eyebrow"><i className={`type-mark ${n.type}`} />{n.type}</span><strong>{n.label || n.id}</strong>
    <span className="node-detail">{n.required_day != null ? `Required · Day ${n.required_day}` : n.day != null ? `Scheduled · Day ${n.day}` : n.field ? `${n.field.replaceAll('_', ' ')} · ${n.value}` : 'Protocol concept'}</span>
    <Handle type="source" position={Position.Right} />
  </div>;
}
const nodeTypes = { concept: ConceptCard };
function Canvas({ graph, selection, highlighted, focusRequest, onSelect }: { graph: GraphPayload; selection: Selection; highlighted: string[]; focusRequest: number; onSelect: (s: Selection) => void }) {
  const { fitView } = useReactFlow();
  const initialNodes = useMemo<ConceptNode[]>(() => graph.nodes.map((concept, i) => ({
    id: concept.id, type: 'concept', data: { concept, highlighted: highlighted.includes(concept.id) },
    selected: selection?.kind === 'node' && selection.id === concept.id,
    position: concept.type === 'eligibility' ? { x: 90 + i * 290, y: 0 } : { x: (i - 2) * 280, y: 205 },
    ariaLabel: `${concept.type}: ${concept.label || concept.id}`,
  })), [graph, selection, highlighted]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  useEffect(() => { setNodes(previous => initialNodes.map(n => ({ ...n, position: previous.find(p => p.id === n.id)?.position ?? n.position }))); }, [initialNodes, setNodes]);
  useEffect(() => { const timer = setTimeout(() => { void fitView({ nodes: focusRequest > 0 && highlighted.length ? highlighted.map(id => ({ id })) : undefined, padding: .16, maxZoom: 1.05, duration: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 180 }); }, 40); return () => clearTimeout(timer); }, [graph, highlighted, focusRequest, fitView]);
  const edges = graph.edges.map((e, i) => ({ id: `edge-${i}`, source: e.source, target: e.target,
    label: e.type.replaceAll('_', ' ').toLowerCase(), type: 'smoothstep',
    selected: selection?.kind === 'edge' && selection.index === i,
    ariaLabel: `${e.source} ${e.type} ${e.target}`, markerEnd: { type: MarkerType.ArrowClosed, color: highlighted.includes(e.source) && highlighted.includes(e.target) ? '#d3b27c' : '#8faaa4', width: 15, height: 15 },
    style: { stroke: highlighted.includes(e.source) && highlighted.includes(e.target) ? '#d3b27c' : '#8faaa4', strokeWidth: highlighted.includes(e.source) && highlighted.includes(e.target) ? 2 : 1.5 },
    labelStyle: { fill: '#b2c7b9', fontSize: 10, fontFamily: 'var(--font-mono)' }, labelBgStyle: { fill: '#111716' },
  }));
  return <ReactFlow nodes={nodes} onNodesChange={onNodesChange} edges={edges} nodeTypes={nodeTypes} nodesConnectable={false}
    onNodeClick={(_, n) => onSelect({ kind: 'node', id: n.id })}
    onEdgeClick={(_, e) => onSelect({ kind: 'edge', index: Number(e.id.slice(5)) })}
    onPaneClick={() => onSelect(null)} fitView fitViewOptions={{ padding: .16, maxZoom: 1.05 }} minZoom={.3} maxZoom={1.8}>
    <Background color="#34483c" gap={28} size={1} /><Controls showInteractive={false} />
  </ReactFlow>;
}
export default function ProtocolCanvas(props: Parameters<typeof Canvas>[0]) {
  return <div className="graph-canvas" aria-label="Interactive protocol graph"><ReactFlowProvider><Canvas {...props} /></ReactFlowProvider></div>;
}
