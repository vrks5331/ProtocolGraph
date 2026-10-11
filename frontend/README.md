# ProtocolGraph frontend

React + TypeScript + Vite workspace for reviewing protocol analyses produced by
the ProtocolGraph backend.

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Start the backend first (see the root [README](../README.md)), then open
http://127.0.0.1:5173. The app starts empty; upload a protocol PDF or open a
previous analysis from History.

| Variable            | Default                 | Purpose                                        |
| ------------------- | ----------------------- | ---------------------------------------------- |
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000` | Backend base URL, set in `frontend/.env.local` |

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run format:check
```

`npm run build` type-checks and bundles the app.

## How it works

- **Upload** (`src/components/UploadDialog.tsx`) sends the PDF to
  `POST /analyze`. Files over 20 MB or that aren't PDFs are rejected before
  upload. Extraction usually takes 1-2 minutes; the dialog shows elapsed time,
  can be cancelled, and gives up after 5 minutes. Backend errors are shown with
  their detail (422 for unextractable PDFs, 503 when `GEMINI_API_KEY` is
  missing).
- **Current analysis** lives in the URL hash (`#/analysis/{id}`, or
  `#/analysis/{id}/scenario/{scenarioId}` with a scenario open), so reloading
  or sharing the link reopens it through `GET /graph/{id}`.
- **History** (`src/components/HistoryPanel.tsx`) lists `GET /history`, newest
  first, and opens an entry on click. Analyses with scenarios show
  "N scenarios", which expands to the list; clicking one opens it in Simulate.
- **Graph** (`src/components/ProtocolCanvas.tsx`) renders with Cytoscape.js in
  a Web layout (circular nodes, cose) or a Flow layout (cards, left-to-right
  dagre); the choice is remembered. Nodes are colored by type; nodes whose
  source quote only matched approximately have a dashed border. Hovering shows a
  tooltip, and clicking a concept zooms to it and highlights its neighbors.
  A search icon on the graph filters concepts and relationships by name.
  Selecting a finding highlights and zooms to its concepts. Text view lists
  every concept and relationship and is the primary view on phones.
- **Inspector** (`src/components/Inspector.tsx`) shows source quotes with links
  to the page in the stored PDF (`GET /graph/{id}/pdf#page=N`), concept and
  relationship details, and extraction notes for the selected item.
- **Plain English** (`src/components/PlainLanguage.tsx`) explains the selected
  concept or relationship for non-experts. A built-in note shows straight away:
  what the concept type means, or a sentence such as "Tumor response is
  measured using CT imaging" with any mandatory/optional/conditional
  qualifiers (`src/lib/glossary.ts`). The same sentences appear under each
  connected concept. The explain button asks the backend for an AI-written
  summary and definitions of the jargon involved.
- **Simulate** (`src/components/SimulateView.tsx`) builds what-if scenarios on
  the open analysis without changing it.
  - Click a concept or relationship and change its details in
    `ScenarioEditor.tsx`. Fields the checks read carry an "Affects checks"
    badge, and changed fields show the original value. Moving or zooming the
    graph is not an edit.
  - Each change goes into an edit log (`src/lib/edits.ts`): changing a field
    again updates the same entry, and changing it back removes it. "Pending
    changes" lists each edit as a sentence with an undo button.
  - Save edits (enabled only once there is an edit) asks for a name and saves
    the scenario, which then becomes read-only; Duplicate copies its edits into
    a new draft. Analyze scenario re-runs the checks on the edited graph.
  - `ScenarioResults.tsx` opens with the outcome (for example "1 new finding")
    and scrolls into view after Analyze. It groups findings as Resolved, New,
    and Unchanged, each with a line naming the edits behind it and an
    "In plain terms" description of the check, and highlights the affected
    concepts. When nothing changes, "Why nothing changed" explains each edit
    (`src/lib/effects.ts`). "Explain the effects in plain English" asks the
    backend for an AI summary.
  - Every editable field has an everyday description, the editor explains the
    selected concept or relationship (with the same AI explain button as the
    inspector), and the empty editor describes what the two checks look at.

`src/lib/api.ts` is the only module that calls the network.
`src/lib/graphUtils.ts` derives finding context from the graph: an eligibility
conflict highlights its evidence nodes, and a missing assessment highlights the
endpoint plus its `MEASURED_BY` procedures and their `SCHEDULED_AT` visits.
`src/lib/types.ts` mirrors `backend/contracts.py`.

Theme tokens live in `src/styles.css`. Cytoscape styles can't read CSS
variables, so graph colors are repeated in `ProtocolCanvas.tsx` and
`TYPE_COLORS` in `graphUtils.ts`.

## Tests

Vitest and Testing Library run against a stubbed `fetch` using the graph in
`../data/injected.json` (`src/test/fixtures.ts`). The Cytoscape canvas is mocked
in `App.test.tsx`, so real canvas interaction needs a manual check in the
browser.

## Manual QA

- Upload a protocol: the timer runs, the graph opens in Graph Explorer, and the
  analysis appears in History.
- Reload the page: the same analysis reopens from the URL.
- Select each finding: its concepts are highlighted and the view zooms to them.
- Click nodes and edges; check the inspector, PDF page links, and the
  zoom/fit buttons.
- Stop the backend: History shows an error and the sidebar shows
  "Backend unreachable".
- At 390px wide, use the text view and the evidence drawer.
- In Simulate, pan and zoom the graph (Save stays disabled), edit a visit day,
  undo it, then save, analyze, and explain a scenario. Reopen it from History.
