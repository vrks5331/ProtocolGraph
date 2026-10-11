import { useEffect, useRef } from 'react';
import cytoscape, { type Core, type ElementDefinition, type StylesheetJson } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { GraphPayload, Selection } from '../lib/types';
import { TYPE_COLORS, edgeId, humanize } from '../lib/graphUtils';

cytoscape.use(dagre);

const MAX_LABEL = 70;

const stylesheet: StylesheetJson = [
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
  {
    selector: 'node.highlighted',
    style: { 'background-color': '#2b291f', 'border-color': '#d3b27c', 'border-width': 2 },
  },
  {
    selector: 'node.selected',
    style: { 'border-color': '#92cbbb', 'border-width': 3.5 },
  },
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
    selector: 'edge.highlighted',
    style: { 'line-color': '#d3b27c', 'target-arrow-color': '#d3b27c', width: 2 },
  },
  {
    selector: 'edge.selected',
    style: { 'line-color': '#92cbbb', 'target-arrow-color': '#92cbbb', width: 2.5 },
  },
];

function truncate(text: string) {
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

function elements(graph: GraphPayload): ElementDefinition[] {
  return [
    ...graph.nodes.map((node) => ({
      group: 'nodes' as const,
      data: {
        id: node.id,
        display: `${node.type.toUpperCase()}\n${truncate(node.label || node.id)}`,
        color: TYPE_COLORS[node.type] ?? '#8faaa4',
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

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function ProtocolCanvas({
  graph,
  selection,
  highlighted,
  fuzzy,
  focusRequest,
  onSelect,
}: {
  graph: GraphPayload;
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

  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({
      container: container.current,
      elements: elements(graph),
      style: stylesheet,
      layout: {
        name: 'dagre',
        rankDir: 'LR',
        nodeSep: 18,
        rankSep: 90,
        padding: 24,
      } as cytoscape.LayoutOptions,
      minZoom: 0.1,
      maxZoom: 2.5,
      autounselectify: true,
      boxSelectionEnabled: false,
    });
    cy.on('tap', 'node', (event) => onSelectRef.current({ kind: 'node', id: event.target.id() }));
    cy.on('tap', 'edge', (event) => onSelectRef.current({ kind: 'edge', id: event.target.id() }));
    cy.on('tap', (event) => {
      if (event.target === cy) onSelectRef.current(null);
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const marked = new Set(highlighted);
    cy.batch(() => {
      cy.elements().removeClass('highlighted selected fuzzy');
      cy.nodes().forEach((node) => {
        if (marked.has(node.id())) node.addClass('highlighted');
        if (fuzzy.has(node.id())) node.addClass('fuzzy');
      });
      cy.edges().forEach((edge) => {
        if (marked.has(edge.source().id()) && marked.has(edge.target().id())) {
          edge.addClass('highlighted');
        }
      });
      if (selection?.kind === 'node' || selection?.kind === 'edge') {
        cy.getElementById(selection.id).addClass('selected');
      }
    });
  }, [graph, selection, highlighted, fuzzy]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || focusRequest === 0 || !highlighted.length) return;
    const marked = new Set(highlighted);
    const targets = cy.nodes().filter((node) => marked.has(node.id()));
    cy.animate({ fit: { eles: targets, padding: 60 } }, { duration: reducedMotion() ? 0 : 250 });
  }, [focusRequest, highlighted]);

  function zoom(factor: number) {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: cy.zoom() * factor,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  }

  return (
    <div className="graph-canvas">
      <div ref={container} className="cy-container" aria-label="Interactive protocol graph" />
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
          onClick={() => cyRef.current?.fit(undefined, 24)}
        >
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
}
