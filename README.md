# ProtocolGraph

ProtocolGraph is a local app that reads a clinical trial protocol PDF and turns it into a map you can inspect, question, and experiment on.

## The problem

A clinical trial protocol is the contract for how a study will run. It says who may join, what results will be measured, which tests will be done, and when people come in. Those facts are written for specialists, often over hundreds of pages, and they are rarely in one place: the synopsis may say one age cutoff, the eligibility list another; an endpoint may be required on day 42 while the only linked scan sits at a screening visit weeks earlier.

That creates three practical problems:

1. **The document is hard to hold in your head.** Objectives, endpoints, procedures, visits, eligibility rules, and analyses are cross-referenced in prose and tables. A reviewer who is not a medical writer or statistician cannot easily see “this result is measured by that scan, which happens at this visit.”
2. **Inconsistencies hide in the gaps.** Two passages can disagree, or a required measurement can have no visit that covers it, and nothing in a PDF viewer will flag that. Catching it means lining up sections by hand.
3. **You cannot safely ask “what if?”** Changing a visit day or a cutoff on paper means reprinting or mentally simulating the rest of the schedule. There is no copy of the protocol you can edit without risking the official version.

Sponsors, monitors, and students all hit this: the protocol is the source of truth, but it is a poor interface for checking that it agrees with itself.

## What ProtocolGraph fixes

ProtocolGraph does not rewrite the protocol and it does not replace a clinical review. It fixes the *interface* problem:

- **One map instead of a pile of sections.** It extracts the protocol into concepts and typed links (this endpoint is measured by this procedure, at this visit) so you can see the study as a graph, search it, and jump back to the exact page and quote.
- **Two checks that a person can verify.** It reports conflicting eligibility cutoffs and endpoints that have no scheduled assessment on the required day. Those are the only automated findings. Each one points at the concepts and passages it used, so you can confirm or dismiss it against the PDF.
- **Jargon, translated.** Click a concept or a link and get an everyday explanation, plus definitions of the medical terms in that passage.
- **What-if edits that cannot corrupt the original.** A scenario is a named list of field changes on a *copy* of the graph. Analyze re-runs the same two checks. The saved analysis and the PDF stay untouched.

It will not tell you whether a trial is ethical, well powered, or well written. It will tell you whether the structured story it extracted from the document is internally consistent on those two points, and it will let you try a change before anyone edits the real protocol.

## What you do in the app

1. Upload a text-based protocol PDF (not a scan of images). Extraction usually takes one to two minutes.
2. **Overview** shows a review queue: the issues the checks found, if any.
3. **Graph Explorer** is the map. Concepts are colored by type. Hover for a tooltip. Click to open the side panel. Switch Web (circles) and Flow (cards). Search with the magnifying glass.
4. **Simulate** copies the map so you can change details (a visit day, an age cutoff, a required assessment day). Save those edits as a named scenario, then analyze. The original analysis never changes.
5. **History** lists every protocol you have analyzed, plus any scenarios under it.

The current protocol lives in the URL, for example `#/analysis/{id}` or `#/analysis/{id}/scenario/{scenarioId}`. Reloading reopens it.

---

## How a protocol becomes a graph

The PDF is first turned into page text. Gemini is then asked to extract a **knowledge graph**: a list of concepts (nodes) and typed links (edges). The model is only allowed to use what the document states. It must not invent visits, tests, or cutoffs that are not written down.

Every concept must include:

- a short id
- a type (see below)
- a human-readable name
- the page it came from
- a **verbatim quote** from that page (not a paraphrase)

If the first JSON from Gemini is malformed, the extractor sends the validation errors back and asks once more. After that, a separate **consistency** pass repairs or drops bad items. Only then do the two review checks run. The result is stored in SQLite, along with the PDF, so you can reopen it later.

### The six kinds of concept

| Type | Everyday meaning | Extra facts the extractor tries to fill in |
| --- | --- | --- |
| **Objective** | A question the study is trying to answer, such as “does this drug shrink tumors?” | — |
| **Endpoint** | The result used to judge that question, such as tumor response or survival time | `required_day`: the study day this result must be measured, if the protocol says so |
| **Procedure** | Something done to a participant: a scan, blood test, exam, or giving the drug | — |
| **Visit** | One scheduled appointment | `day`: study day (Day 1 is usually the first dose; screening is often a negative day). `window_before_days` / `window_after_days`: how early or late the visit may happen |
| **Eligibility** | One rule for who may join (inclusion) or who may not (exclusion) | For a comparable cutoff: `field` (a snake_case name such as `minimum_age`) and `value` (the cutoff). Qualitative rules omit both |
| **Analysis** | The statistical method used to turn measurements into a conclusion | — |

Visit rules the model is told to follow:

- Create **one visit node per occurrence**. A repeating “every cycle” row is not one node.
- Extract the whole schedule: screening, each treatment cycle, end of treatment, safety follow-up, long-term follow-up.
- If a visit is timed from an event (“30 days after the last dose”) and has no study day, leave `day` empty and put the timing in the description.

Eligibility rules:

- One node **per passage**. If the synopsis says age 18 and the eligibility list says age 21, those are two nodes, even though they are “the same” rule. That is how the conflict check can fire.
- `field` is the thing being compared (`minimum_age`, `alt_max`, …). `value` is the number or short cutoff.

### The five kinds of link

A link may only connect two specific types, and only in this direction. Wrong pairs are thrown away.

| Link | From → to | Everyday meaning |
| --- | --- | --- |
| **SUPPORTS** | objective → endpoint | This result is measured to answer that objective |
| **MEASURED_BY** | endpoint → procedure | This result is measured using that test |
| **SCHEDULED_AT** | procedure → visit | That test is done at this visit |
| **ANALYZED_BY** | endpoint → analysis | This result is evaluated with that statistical method |
| **REQUIRES_AT** | eligibility → visit | This joining rule is checked at this visit |

The extractor is also told to:

- link every procedure to **each** visit where the schedule performs it
- link every endpoint to the procedure that measures it

Optional details on a link (the review checks do **not** read these yet):

- `required`: true if the protocol says “must” / “will be performed”; false if it says “may” / “optional”; omitted if it does not say
- `condition_text`: “only if measurable disease”
- `arm_ids` / `pop_ids`: which treatment groups or populations the link applies to; omitted if it applies to everyone

---

## Cleanup before anything is shown to you

Gemini’s draft is not trusted as-is. A deterministic pass walks every concept and link.

**Quotes must come from the PDF.** A quote shorter than 15 characters is usually dropped (a bare `"2"` from a table can match anything). Longer quotes must appear on the cited page, after normalizing quotes, dashes, and line breaks. If the quote is on a different page, the page number is corrected. Table cells that are not one contiguous sentence can still be kept if enough of their words appear on the cited page; those get a dashed “approximate match” mark in the graph.

**Fields must sit on the right type.** `required_day` may only stay on an endpoint. `day` and the two window fields may only stay on a visit. `field` and `value` may only stay on eligibility. Anything else is stripped.

**Links must be legal.** A link to a dropped concept is dropped. A concept may not link to itself. A `MEASURED_BY` that does not go endpoint → procedure is dropped. Duplicate links between the same two concepts are merged.

If that pass leaves no concepts or no links, extraction fails and nothing is stored.

Anything the cleanup changed is listed as an **extraction note** on the concept (dropped, page corrected, approximate quote, merged link). Those notes are not the same as findings.

---

## What the app actually checks

After the graph is stored, two rules run. They only look at the structured fields below. They never re-read the PDF and they never call Gemini.

### 1. Conflicting eligibility values

**Question:** does the protocol give two different cutoffs for the same joining rule?

**How:** group eligibility concepts that have both a `field` and a `value`. If one field (for example `minimum_age`) has more than one distinct value (`18` and `21`), that is a finding.

**What it is not:** two different fields (age vs ALT) never conflict. A criterion with no `field` or no `value` is ignored — it is treated as a qualitative rule. A field that appears only once cannot conflict with anything.

**Example:** synopsis says “at least 18 years” (`minimum_age` = 18) and the inclusion list says “age 21 or older” (`minimum_age` = 21) → finding.

### 2. Missing scheduled assessment

**Question:** if an endpoint must be measured on a certain study day, is there a visit in that window where the measuring test actually happens?

**How:** for each endpoint that has a `required_day`, look for a path:

`endpoint` —MEASURED_BY→ `procedure` —SCHEDULED_AT→ `visit`

The visit must have a `day`. The allowed window is:

`visit.day − window_before_days` through `visit.day + window_after_days`

(missing windows count as 0). If **any** such visit covers the required day, the endpoint is fine. If none do, that is a finding.

**What it is not:** endpoints with no `required_day` are skipped. A visit with no `day` cannot cover anything. A procedure that is not linked to the endpoint does not count, even if it happens on the right day. Editing a visit window only matters if that visit is on this path.

**Example:** tumor response must be assessed on day 42. The only linked CT scan is at baseline, day 0, with no window → finding. Move baseline to day 42, or give it a window that includes 42, and the finding goes away.

Those are the **only** two findings today. Changing a label, a description, or an edge’s “required” flag cannot create or resolve them.

---

## Scenarios (what-if edits)

A scenario is a named list of field changes, stored under its parent analysis. The parent never changes.

You can edit:

| On | Fields | Can change findings? |
| --- | --- | --- |
| Any concept | label, description | No |
| Visit | study day (may be negative), window before, window after (0 or more) | Yes |
| Endpoint | required day (0 or more) | Yes |
| Eligibility | value | Yes |
| Link | required, condition, arms, populations | No (not read by the checks yet) |

You cannot add or delete concepts or links. Moving or zooming the graph is not an edit.

Each change is stored as “this field on this item went from X to Y.” Changing the same field again keeps the original X. Changing it back to X removes the entry. Save is available only when something actually changed. After save, the scenario is locked; Duplicate copies the edits into a new draft.

**Analyze** reapplies the edits to a copy of the stored graph and runs the same two checks. It diffs findings by id into Resolved, New, and Unchanged. It does not call Gemini. If an edit’s “before” value no longer matches the stored graph, save is rejected so you cannot apply a stale change.

The AI “explain the effects” button is optional. It gets the edit list, the finding diff, and the original quotes of the affected concepts.

---

## What this is not

- Not a full protocol review (safety, statistics, regulatory completeness, writing quality).
- Not medical advice.
- Not a substitute for reading the PDF.
- Extraction can miss a visit day or a required day. When those fields are empty, the schedule check has nothing to compare — that looks like “no findings,” not “the protocol is fine.”
- Scanned PDFs with no text cannot be extracted.
- Gemini is used for extraction and for optional plain-English write-ups. It is sometimes busy (high demand). The two checks themselves never call it.

---

## Tech stack

The app is two processes that talk over HTTP: a Python API and a React workspace.

**Backend (Python)**

- **FastAPI** + **Uvicorn** — the HTTP API (`/analyze`, graph, history, scenarios, explanations).
- **Pydantic** — the shared contract: what a concept, link, finding, and scenario edit are allowed to look like.
- **pypdf** — pull text out of the uploaded PDF, page by page.
- **Gemini** (`google-genai`, default model `gemini-3.8-flash`) — extract the graph from that text, and write optional plain-English explanations. The two consistency checks never call it.
- **NetworkX** — the directed graph the schedule and eligibility rules walk.
- **SQLite** — saved analyses, PDFs, scenarios, and cached explanations on disk.

**Frontend (TypeScript)**

- **React 19** + **Vite 6** — the workspace UI.
- **Cytoscape.js** with **cose** (Web) and **cytoscape-dagre** (Flow) — the interactive map.
- **Tailwind CSS 4** plus the tokens in `frontend/src/styles.css`.
- **Vitest** and Testing Library for UI tests; **pytest** for the API.

The browser calls the API at `http://127.0.0.1:8000` unless you set `VITE_API_BASE_URL`. Analyses stay on your machine under `~/.protocolgraph/` unless you point `PROTOCOLGRAPH_DB_PATH` somewhere else.

---

## Run it locally

Create a `.env` in the repo root:

```text
GEMINI_API_KEY=your-key
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | none (required to analyze a PDF or ask for an AI explanation) | Gemini API key |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Model used for extraction |
| `FRONTEND_ORIGINS` | ports 5173 and 3000 on `127.0.0.1` and `localhost` | Browser origins allowed to call the API |
| `PROTOCOLGRAPH_DB_PATH` | `~/.protocolgraph/analyses.sqlite3` | Where analyses and uploaded PDFs are stored |

```powershell
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --reload-dir backend --port 8000
```

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open http://127.0.0.1:5173 with the API at http://127.0.0.1:8000. If `pip` fails on certificates, use `uv pip install --native-tls -r requirements.txt`. If `npm install` fails on certificates, set `NODE_USE_SYSTEM_CA=1` first.

Developer details (API routes, modules, frontend structure) live in [frontend/README.md](frontend/README.md). A click-through of every screen is in [MANUAL_QA.md](MANUAL_QA.md).

```powershell
python -m pytest
cd frontend
npm.cmd test
npm.cmd run format:check
```

Backend tests fake Gemini and never call the network. GitHub Actions runs the backend tests and the frontend format check, tests, and build on every pull request and on pushes to `main`.
