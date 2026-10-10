# ProtocolGraph frontend

Local React + TypeScript + Vite workspace. No backend, API key, or database is required.

```sh
cd frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173. On Windows with PowerShell script restrictions, use `npm.cmd` instead of `npm`.

```sh
npm run build
npm test
```

The build includes strict TypeScript checking. Vitest and Testing Library verify dataset switching, canonical findings, evidence selection, history navigation, and adapter isolation.

## Mock mode and integration

The dark interface uses forest charcoal surfaces, pale emerald accents, and restrained coral/amber findings. Tokens for typography, spacing, radii, borders, and states live in `src/styles.css`. Inter is bundled locally for interface text and evidence passages; JetBrains Mono appears in graph labels, relationship labels, study days, IDs, and compact metadata. The theme uses one stylesheet with no stacked overrides.

The injected protocol is selected by default, with its eligibility evidence ready in the collapsible inspector. The complete graph is visible initially; selecting a finding focuses its related nodes and highlights the corresponding edges. Phones use the text alternative and a dismissible evidence drawer instead of a compressed canvas.

Simulate edits one selected endpoint or visit at a time: required day, scheduled day, and visit windows. The adapter compares new, resolved, and remaining findings using the two limited demo checks. No backend call or persistence occurs. Reset or switching datasets clears the preview; original graphs and source evidence remain unchanged.

The adapter imports the original `../data/baseline.json` and `../data/injected.json` directly. No duplicate fixtures are maintained. Demo findings are centralized in `src/lib/analysisAdapter.ts`; they are the two documented fixture scenarios, not a clinical rules engine. Sample history has no fabricated timestamps or uploaded filenames.

`src/lib/types.ts` reflects the backend graph, findings, analysis, and history contracts. Replace the mock adapter with asynchronous API access when integrating, adding loading/error handling in the workspace: `POST /analyze`, `GET /graph/{analysis_id}`, and `GET /history`. Keep real timestamped history separate from demo metadata. The current upload dialog explicitly explains that PDF ingestion is unavailable; `analyzeProtocol` rejects rather than fabricating success. No application network requests are made.

React Flow provides deterministic graph layout, keyboard-selectable nodes/edges, pan, zoom, and fit controls. Text view exposes every concept and relationship. On phones the text view is primary; selected evidence opens in a dismissible drawer. Desktop uses a persistent inspector.

## Manual QA

- At 1440px and 1280px: check navigation, graph labels, pan/zoom/fit, node and edge selection, and inspector spacing.
- Start on Protocol with issues: exactly two findings and the eligibility conflict's source passages are visible. Select each finding to focus related concepts and relationships.
- Return to baseline: the qualified no-issues state appears with the response endpoint selected.
- Collapse and reopen the evidence inspector; trace a finding to a concept and its original page/quote.
- In Simulate, move Baseline visit to day 42: the assessment finding resolves and the eligibility conflict remains. Reset restores day 0. Select an endpoint or visit and test all supported fields.
- Check Overview, Graph Explorer, Simulate, and Demo history navigation, then the upload information dialog (Escape and Close dismiss it).
- At 390px: inspect the concept/relationship list, open and dismiss the evidence drawer, and verify no horizontal page overflow.
- Use Tab/Enter and check visible focus rings; enable reduced motion.
- Verify the browser console has no errors. Automated UI tests substitute the canvas; real canvas interactions require browser QA.
