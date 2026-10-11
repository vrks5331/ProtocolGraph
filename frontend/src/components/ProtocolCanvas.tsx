import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, {
  type Core,
  type ElementDefinition,
  type EventObject,
  type StylesheetJson,
} from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { Concept, GraphPayload, Selection } from '../lib/types';
import { TYPE_COLORS, conceptLabel, edgeId, humanize } from '../lib/graphUtils';
import { relationshipSentence } from '../lib/glossary';

cytoscape.use(dagre);

export type GraphLayout = 'web' | 'flow';

const TOOLTIP_WIDTH = 260;
const MAX_CARD_LABEL = 70;

const webStyle: StylesheetJson = [
  {
    selector: 'node',
    style: {
      shape: 'ellipse',
      width: 'data(size)',
      height: 'data(size)',
      'background-color': 'data(color)',
      'border-width': 1.5,
      'border-color': '#111716',
      label: '',
      color: '#e0e8e3',
      'font-family': 'JetBrains Mono, monospace',
      'font-size': 9,
      'text-valign': 'bottom',
      'text-margin-y': 4,
      'text-wrap': 'ellipsis',
      'text-max-width': '140px',
      'text-outline-color': '#111716',
      'text-outline-width': 2,
      'min-zoomed-font-size': 6,
    },
  },
  { selector: 'node.fuzzy', style: { 'border-style': 'dashed', 'border-color': '#e0e8e3' } },
  { selector: 'node.hover', style: { 'border-color': '#e0e8e3', 'border-width': 2.5 } },
  {
    selector: 'node.highlighted',
    style: { 'border-color': '#d3b27c', 'border-width': 3.5, label: 'data(name)' },
  },
  {
    selector: 'node.selected',
    style: { 'border-color': '#ffffff', 'border-width': 4, label: 'data(name)' },
  },
  {
    selector: 'edge',
    style: {
      width: 1.2,
      'curve-style': 'straight',
      'line-color': '#45584d',
      'target-arrow-color': '#45584d',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.7,
    },
  },
  {
    selector: 'edge.hover',
    style: { 'line-color': '#92cbbb', 'target-arrow-color': '#92cbbb', width: 2.5 },
  },
  {
    selector: 'edge.highlighted',
    style: { 'line-color': '#d3b27c', 'target-arrow-color': '#d3b27c', width: 2.2 },
  },
  {
    selector: 'edge.selected',
    style: { 'line-color': '#ffffff', 'target-arrow-color': '#ffffff', width: 3 },
  },
  { selector: 'node.dimmed', style: { opacity: 0.2 } },
  { selector: 'edge.dimmed', style: { opacity: 0.1 } },
];

const flowStyle: StylesheetJson = [
  {
    selector: 'node',
    style: {
      shape: 'round-rectangle',
      width: 176,
      height: 58,
      'background-color': '#19201e',
      'border-width': 1.5,
      'border-color': 'data(color)',
      label: 'data(display)',
      color: '#e0e8e3',
      'font-family': 'JetBrains Mono, monospace',
      'font-size': 10,
      'text-wrap': 'wrap',
      'text-max-width': '158px',
      'text-valign': 'center',
      'text-halign': 'center',
      'min-zoomed-font-size': 6,
    },
  },
  { selector: 'node.fuzzy', style: { 'border-style': 'dashed' } },
  { selector: 'node.hover', style: { 'background-color': '#222e27' } },
  {
    selector: 'node.highlighted',
    style: { 'background-color': '#2b291f', 'border-color': '#d3b27c', 'border-width': 2 },
  },
  { selector: 'node.selected', style: { 'border-color': '#92cbbb', 'border-width': 3.5 } },
  {
    selector: 'edge',
    style: {
      width: 1.2,
      'curve-style': 'bezier',
      'line-color': '#5f7a6e',
      'target-arrow-color': '#5f7a6e',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.8,
      label: 'data(label)',
      color: '#b2c7b9',
      'font-family': 'JetBrains Mono, monospace',
      'font-size': 8,
      'text-background-color': '#111716',
      'text-background-opacity': 1,
      'text-background-padding': '2px',
      'min-zoomed-font-size': 7,
    },
  },
  {
    selector: 'edge.hover',
    style: { 'line-color': '#92cbbb', 'target-arrow-color': '#92cbbb', width: 2 },
  },
  {
    selector: 'edge.highlighted',
    style: { 'line-color': '#d3b27c', 'target-arrow-color': '#d3b27c', width: 2 },
  },
  {
    selector: 'edge.selected',
    style: { 'line-color': '#92cbbb', 'target-arrow-color': '#92cbbb', width: 2.5 },
  },
  { selector: 'node.dimmed', style: { opacity: 0.35 } },
  { selector: 'edge.dimmed', style: { opacity: 0.2 } },
];

const LAYOUTS: Record<GraphLayout, { style: StylesheetJson; options: cytoscape.LayoutOptions }> = {
  web: {
    style: webStyle,
    options: {
      name: 'cose',
      animate: false,
      randomize: true,
      padding: 30,
      nodeRepulsion: () => 9000,
      idealEdgeLength: () => 70,
      edgeElasticity: () => 100,
      gravity: 0.3,
      componentSpacing: 60,
      numIter: 1500,
    } as cytoscape.LayoutOptions,
  },
  flow: {
    style: flowStyle,
    options: {
      name: 'dagre',
      rankDir: 'LR',
      nodeSep: 18,
      rankSep: 90,
      padding: 24,
    } as cytoscape.LayoutOptions,
  },
};

function truncate(text: string) {
  return text.length > MAX_CARD_LABEL ? `${text.slice(0, MAX_CARD_LABEL - 1)}…` : text;
}

function elements(graph: GraphPayload): ElementDefinition[] {
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return [
    ...graph.nodes.map((node) => ({
      group: 'nodes' as const,
      data: {
        id: node.id,
        name: conceptLabel(node),
        display: `${node.type.toUpperCase()}\n${truncate(conceptLabel(node))}`,
        color: TYPE_COLORS[node.type] ?? '#8faaa4',
        size: 16 + Math.min(degree.get(node.id) ?? 0, 12) * 2.5,
      },
    })),
    ...graph.edges.map((edge) => ({
      group: 'edges' as const,
      data: {
        id: edgeId(edge),
        source: edge.source,
        target: edge.target,
        label: humanize(edge.type).toLowerCase(),
      },
    })),
  ];
}

function nodeDetail(node: Concept): string | null {
  if (node.required_day != null) return `Assessed on study day ${node.required_day}`;
  if (node.day != null) {
    const before = node.window_before_days ?? 0;
    const after = node.window_after_days ?? 0;
    const window = before || after ? ` (−${before} / +${after} days)` : '';
    return `Study day ${node.day}${window}`;
  }
  if (node.field) return `${humanize(node.field)}: ${String(node.value ?? '')}`;
  return null;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Hover = { kind: 'node' | 'edge'; id: string; x: number; y: number };

export default function ProtocolCanvas({
  graph,
  layout,
  selection,
  highlighted,
  fuzzy,
  focusRequest,
  onSelect,
}: {
  graph: GraphPayload;
  layout: GraphLayout;
  selection: Selection;
  highlighted: string[];
  fuzzy: Set<string>;
  focusRequest: number;
  onSelect: (selection: Selection) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [hover, setHover] = useState<Hover | null>(null);
  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph]);
  const edgesById = useMemo(
    () => new Map(graph.edges.map((edge) => [edgeId(edge), edge])),
    [graph],
  );

  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({
      container: container.current,
      elements: elements(graph),
      style: LAYOUTS[layout].style,
      layout: LAYOUTS[layout].options,
      minZoom: 0.15,
      maxZoom: 3,
      autounselectify: true,
      boxSelectionEnabled: false,
    });
    const track = (event: EventObject) => {
      const target = event.target;
      setHover({
        kind: target.isNode() ? 'node' : 'edge',
        id: target.id(),
        x: event.renderedPosition.x,
        y: event.renderedPosition.y,
      });
    };
    cy.on('mouseover', 'node, edge', (event) => {
      event.target.addClass('hover');
      if (container.current) container.current.style.cursor = 'pointer';
      track(event);
    });
    cy.on('mousemove', 'node, edge', track);
    cy.on('mouseout', 'node, edge', (event) => {
      event.target.removeClass('hover');
      if (container.current) container.current.style.cursor = '';
      setHover(null);
    });
    cy.on('viewport', () => setHover(null));
    cy.on('tap', 'node', (event) => onSelectRef.current({ kind: 'node', id: event.target.id() }));
    cy.on('tap', 'edge', (event) => onSelectRef.current({ kind: 'edge', id: event.target.id() }));
    cy.on('tap', (event) => {
      if (event.target === cy) onSelectRef.current(null);
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
      setHover(null);
    };
  }, [graph, layout]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const marked = new Set(highlighted);
    const focusing = marked.size > 0;
    cy.batch(() => {
      cy.elements().removeClass('highlighted selected fuzzy dimmed');
      cy.nodes().forEach((node) => {
        if (marked.has(node.id())) node.addClass('highlighted');
        else if (focusing) node.addClass('dimmed');
        if (fuzzy.has(node.id())) node.addClass('fuzzy');
      });
      cy.edges().forEach((edge) => {
        if (marked.has(edge.source().id()) && marked.has(edge.target().id())) {
          edge.addClass('highlighted');
        } else if (focusing) {
          edge.addClass('dimmed');
        }
      });
      if (selection?.kind === 'node' || selection?.kind === 'edge') {
        cy.getElementById(selection.id).removeClass('dimmed').addClass('selected');
      }
    });
  }, [graph, layout, selection, highlighted, fuzzy]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || focusRequest === 0 || !highlighted.length) return;
    const marked = new Set(highlighted);
    const targets = cy.nodes().filter((node) => marked.has(node.id()));
    cy.animate({ fit: { eles: targets, padding: 80 } }, { duration: reducedMotion() ? 0 : 250 });
  }, [focusRequest, highlighted]);

  function zoom(factor: number) {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: cy.zoom() * factor,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  }

  function renderTooltip(current: Hover) {
    const width = container.current?.clientWidth ?? Infinity;
    const flip = current.x + TOOLTIP_WIDTH + 24 > width;
    const style = {
      left: flip ? current.x - TOOLTIP_WIDTH - 14 : current.x + 14,
      top: current.y + 14,
      width: TOOLTIP_WIDTH,
    };
    if (current.kind === 'node') {
      const node = nodesById.get(current.id);
      if (!node) return null;
      const detail = nodeDetail(node);
      return (
        <div className="graph-tooltip" style={style} role="tooltip">
          <span className="eyebrow">
            <i style={{ background: TYPE_COLORS[node.type] }} /> {node.type}
          </span>
          <strong>{conceptLabel(node)}</strong>
          {detail && <small>{detail}</small>}
          {node.page != null && <small>Page {node.page}</small>}
          {fuzzy.has(node.id) && <small>Source quote matched approximately</small>}
        </div>
      );
    }
    const edge = edgesById.get(current.id);
    if (!edge) return null;
    return (
      <div className="graph-tooltip" style={style} role="tooltip">
        <span className="eyebrow">{humanize(edge.type).toLowerCase()}</span>
        <p>{relationshipSentence(edge, nodesById.get(edge.source), nodesById.get(edge.target))}</p>
      </div>
    );
  }

  return (
    <div className="graph-canvas">
      <div ref={container} className="cy-container" aria-label="Interactive protocol graph" />
      {hover && renderTooltip(hover)}
      <div className="canvas-controls">
        <button className="icon-button" aria-label="Zoom in" onClick={() => zoom(1.25)}>
          <ZoomIn size={15} />
        </button>
        <button className="icon-button" aria-label="Zoom out" onClick={() => zoom(0.8)}>
          <ZoomOut size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Fit graph to view"
          onClick={() => cyRef.current?.fit(undefined, 30)}
        >
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
}
