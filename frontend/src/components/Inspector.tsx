import { ArrowUpRight, BookOpen, ExternalLink, PanelRightClose, TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AnalysisResponse, Concept, Evidence, Relationship, Selection } from '../lib/types';
import { explainConcept, explainRelationship, pdfUrl } from '../lib/api';
import { TYPE_EXPLANATIONS, relationshipSentence } from '../lib/glossary';
import PlainLanguage from './PlainLanguage';
import {
  conceptLabel,
  edgeId,
  findingExplanation,
  humanize,
  issuesFor,
  relatedNodes,
} from '../lib/graphUtils';

interface InspectorProps {
  analysis: AnalysisResponse;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onGraph: () => void;
  mobileOpen: boolean;
  onClose: () => void;
}
const NODE_FIELDS = [
  'field',
  'value',
  'required_day',
  'day',
  'window_before_days',
  'window_after_days',
  'confidence',
  'description',
] as const;

export default function Inspector({
  analysis,
  selection,
  onSelect,
  onGraph,
  mobileOpen,
  onClose,
}: InspectorProps) {
  const closeControl = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobileOpen || !window.matchMedia?.('(max-width: 1000px)').matches) return;
    const previous = document.activeElement as HTMLElement | null;
    closeControl.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [mobileOpen]);
  const { analysis_id, graph, findings, extraction_issues } = analysis;
  const nodesById = new Map(graph.nodes.map((item) => [item.id, item]));
  const node = selection?.kind === 'node' ? nodesById.get(selection.id) : undefined;
  const finding =
    selection?.kind === 'finding' ? findings.find((item) => item.id === selection.id) : undefined;
  const edge =
    selection?.kind === 'edge'
      ? graph.edges.find((item) => edgeId(item) === selection.id)
      : undefined;
  const connections = node
    ? graph.edges
        .filter((relation) => relation.source === node.id || relation.target === node.id)
        .map((relation) => ({
          relation,
          other: nodesById.get(relation.source === node.id ? relation.target : relation.source),
        }))
        .filter((item): item is { relation: Relationship; other: Concept } => Boolean(item.other))
    : [];
  const connected = node
    ? connections.map((item) => item.other)
    : finding
      ? relatedNodes(finding, graph).map((id) => nodesById.get(id)!)
      : edge
        ? graph.nodes.filter((item) => [edge.source, edge.target].includes(item.id))
        : [];
  const evidence: Evidence[] = node
    ? [{ node_id: node.id, page: node.page, quote: node.source_text }]
    : finding?.check_id === 'missing_assessment'
      ? connected.map((item) => ({ node_id: item.id, page: item.page, quote: item.source_text }))
      : finding?.evidence || [];
  const notes = node
    ? issuesFor(node.id, extraction_issues)
    : edge
      ? issuesFor(edgeId(edge), extraction_issues)
      : [];
  const edgeDetails = edge
    ? (
        [
          ['required', edge.required == null ? null : edge.required ? 'Yes' : 'No'],
          ['condition', edge.condition_text],
          ['arms', edge.arm_ids?.length ? edge.arm_ids.join(', ') : null],
          ['populations', edge.pop_ids?.length ? edge.pop_ids.join(', ') : null],
          ['confidence', edge.confidence],
        ] as const
      ).filter(([, value]) => value != null && value !== '')
    : [];
  const subject = selection?.kind === 'finding' ? finding : node || edge;

  function inspectNode(id: string) {
    onGraph();
    onSelect({ kind: 'node', id });
  }
  return (
    <aside
      className={`inspector ${mobileOpen ? 'mobile-open' : ''}`}
      aria-label="Evidence inspector"
    >
      <div className="panel-heading">
        <h2>Source evidence</h2>
        <button
          ref={closeControl}
          className="icon-button"
          aria-label="Close evidence inspector"
          onClick={onClose}
        >
          <PanelRightClose size={17} />
        </button>
      </div>
      {!subject ? (
        <div className="inspector-prompt">
          <BookOpen size={22} />
          <h3>Select a concept</h3>
          <p>
            Inspect a graph concept or review item to view its protocol passages and connections.
          </p>
        </div>
      ) : (
        <div className="inspector-content">
          <span
            className={`inspector-type ${finding?.tier === 'verified' ? 'red' : finding ? 'amber' : ''}`}
          >
            {node?.type ||
              (finding
                ? finding.tier === 'verified'
                  ? 'Verified contradiction'
                  : 'Missing dependency'
                : 'Relationship')}
          </span>
          <h3>
            {node
              ? conceptLabel(node)
              : finding
                ? finding.title
                : humanize(edge!.type).toLowerCase()}
          </h3>
          {node && <code>{node.id}</code>}
          {node && (
            <PlainLanguage
              key={`${analysis_id}:${node.id}`}
              cacheKey={`${analysis_id}:${node.id}`}
              intro={TYPE_EXPLANATIONS[node.type]}
              label="Explain this in plain English"
              explain={() => explainConcept(analysis_id, node.id)}
            />
          )}
          {edge && (
            <>
              <p className="edge-path">
                {conceptLabel(nodesById.get(edge.source), edge.source)} →{' '}
                {conceptLabel(nodesById.get(edge.target), edge.target)}
              </p>
              <PlainLanguage
                key={`${analysis_id}:edge:${edgeId(edge)}`}
                cacheKey={`${analysis_id}:edge:${edgeId(edge)}`}
                intro={relationshipSentence(
                  edge,
                  nodesById.get(edge.source),
                  nodesById.get(edge.target),
                )}
                label="Explain this connection in plain English"
                explain={() => explainRelationship(analysis_id, edgeId(edge))}
              />
            </>
          )}
          {finding && (
            <>
              <p className="finding-explanation">{findingExplanation(finding, graph)}</p>
              <button className="text-button" onClick={onGraph}>
                Locate in graph <ArrowUpRight size={14} />
              </button>
            </>
          )}
          {!edge && (
            <section className="evidence-section">
              <h4>
                <BookOpen size={14} /> Protocol passages
              </h4>
              {evidence.some((item) => item.quote) ? (
                evidence
                  .filter((item) => item.quote)
                  .map((item) => (
                    <blockquote key={item.node_id}>
                      <div className="quote-heading">
                        <span>Page {item.page ?? 'unspecified'}</span>
                        {!node && (
                          <button
                            aria-label={`Inspect ${conceptLabel(nodesById.get(item.node_id), item.node_id)}`}
                            className="icon-button"
                            onClick={() => inspectNode(item.node_id)}
                          >
                            <ArrowUpRight size={14} />
                          </button>
                        )}
                      </div>
                      <p>“{item.quote}”</p>
                      {item.page != null && (
                        <a
                          className="pdf-link"
                          href={pdfUrl(analysis_id, item.page)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open page {item.page} in PDF <ExternalLink size={11} />
                        </a>
                      )}
                    </blockquote>
                  ))
              ) : (
                <p className="muted">No source passage was captured for this item.</p>
              )}
            </section>
          )}
          {node && (
            <section>
              <h4>Concept details</h4>
              <dl>
                {NODE_FIELDS.filter((key) => node[key] != null && node[key] !== '').map((key) => (
                  <div key={key}>
                    <dt>{humanize(key)}</dt>
                    <dd className={key === 'description' ? '' : 'mono'}>{String(node[key])}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {edgeDetails.length > 0 && (
            <section>
              <h4>Relationship details</h4>
              <dl>
                {edgeDetails.map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd className={key === 'condition' ? '' : 'mono'}>{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {notes.length > 0 && (
            <section className="extraction-notes">
              <h4>
                <TriangleAlert size={14} /> Extraction notes
              </h4>
              {notes.map((issue, index) => (
                <p key={`${issue.rule}-${index}`}>
                  <span className="mono">{humanize(issue.action)}</span>
                  {issue.message}
                </p>
              ))}
            </section>
          )}
          {node && connections.length > 0 && (
            <section>
              <h4>Connected concepts</h4>
              {connections.map(({ relation, other }) => (
                <div className="connection" key={edgeId(relation)}>
                  <button className="connected-node" onClick={() => inspectNode(other.id)}>
                    <span>
                      <strong>{conceptLabel(other)}</strong>
                      <small>{other.type}</small>
                    </span>
                    <ArrowUpRight size={13} />
                  </button>
                  <p className="connection-sentence">
                    {relationshipSentence(
                      relation,
                      nodesById.get(relation.source),
                      nodesById.get(relation.target),
                    )}
                  </p>
                  <button
                    className="text-button connection-more"
                    onClick={() => onSelect({ kind: 'edge', id: edgeId(relation) })}
                  >
                    Explain this connection
                  </button>
                </div>
              ))}
            </section>
          )}
          {!node && connected.length > 0 && (
            <section>
              <h4>{finding ? 'Affected concepts' : 'Connected concepts'}</h4>
              {connected.map((item) => (
                <button
                  className="connected-node"
                  key={item.id}
                  onClick={() => inspectNode(item.id)}
                >
                  <span>
                    <strong>{conceptLabel(item)}</strong>
                    <small>{item.type}</small>
                  </span>
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </section>
          )}
          <button className="text-button clear-selection" onClick={() => onSelect(null)}>
            Clear selection
          </button>
        </div>
      )}
    </aside>
  );
}
