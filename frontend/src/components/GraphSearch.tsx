import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { searchGraph } from '../lib/graphUtils';
import type { GraphPayload, Selection } from '../lib/types';

export default function GraphSearch({
  graph,
  onSelect,
}: {
  graph: GraphPayload;
  onSelect: (selection: Selection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hits = searchGraph(graph, query);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function choose(hit: (typeof hits)[number]) {
    onSelect({ kind: hit.kind, id: hit.id });
    setQuery('');
    setOpen(false);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
      setQuery('');
      return;
    }
    if (!hits.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % hits.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index - 1 + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(hits[active]);
    }
  }

  return (
    <div className={`graph-search ${open ? 'open' : ''}`}>
      {open ? (
        <>
          <Search size={14} aria-hidden />
          <input
            ref={input}
            role="combobox"
            aria-label="Search the graph"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder="Search concepts and relationships"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKey}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 120);
            }}
          />
          {query.trim() && (
            <ul id={listId} role="listbox" className="graph-search-results">
              {hits.length === 0 ? (
                <li className="muted">No matches</li>
              ) : (
                hits.map((hit, index) => (
                  <li key={`${hit.kind}:${hit.id}`} role="presentation">
                    <button
                      role="option"
                      aria-selected={index === active}
                      className={index === active ? 'active' : ''}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(hit)}
                    >
                      <span className="eyebrow">{hit.detail}</span>
                      <strong>{hit.label}</strong>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      ) : (
        <button className="icon-button" aria-label="Search the graph" onClick={() => setOpen(true)}>
          <Search size={15} />
        </button>
      )}
    </div>
  );
}
