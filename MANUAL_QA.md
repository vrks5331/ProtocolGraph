# Manual QA

A self-test you can run in about 30–40 minutes. Do the automated checks first, then walk the app the way a reviewer would. The NCT03679767 analysis is the best file for this: it already has visit days, eligibility values, and saved scenarios.

## 0. Start the app

Two terminals:

```powershell
python -m uvicorn backend.main:app --reload --reload-dir backend --port 8000
```

```powershell
cd frontend
npm.cmd run dev
```

Open http://127.0.0.1:5173. Sidebar footer should say **Local workspace**, not **Backend unreachable**.

## 1. Automated confidence (2 minutes)

From the repo root:

```powershell
python -m pytest
cd frontend
npm.cmd test
npm.cmd run format:check
```

Expect **90** backend tests and **41** frontend tests, all green. That covers contracts, rules, scenario save/analyze/explain, edit merge/undo, History, and the Simulate UI. It does **not** cover real Cytoscape clicks or a live Gemini call. Those are the rest of this guide.

## 2. Empty workspace and upload

If you already have analyses, skip the empty-state bits and use History.

| Check | What you should see |
| --- | --- |
| Overview with nothing open | “Upload a protocol to get started” |
| Upload a non-PDF | Dialog rejects it before the request |
| Upload a huge fake file (>20 MB) | “20 MB” error, Analyze stays disabled |
| Upload NCT03679767.pdf (or NCT04082572.pdf) | Timer runs (1–2 min is normal). Graph Explorer opens. Filename appears in the top bar. PDF link works. |
| Cancel mid-upload | Request stops; no half-written analysis |
| History after upload | New file at the top |

Gemini sometimes returns **high demand (503)**. Retry. If it keeps failing, open the existing NCT03679767 analysis from History instead of re-uploading.

## 3. Overview and review queue

Open NCT03679767 (or any saved analysis). Stay on **Overview**.

| Check | What you should see |
| --- | --- |
| Summary strip | Concept count, relationship count, finding count. “Review needed” or “No issues found”. |
| Click a finding | Inspector opens. Graph Explorer is selected. Related nodes highlight and the view zooms. |
| Escape | Inspector closes |
| PDF page link in the inspector | Opens the stored PDF at that page |
| “Locate in graph” | Same highlight/zoom |

NCT03679767 currently has **0 findings**. That’s fine. The review queue should say no issues. You’ll create findings later in Simulate.

## 4. Graph Explorer

| Check | What you should see |
| --- | --- |
| **Web** layout | Circular colored nodes, labels mostly hidden until hover/select |
| **Flow** layout | Card nodes, left-to-right, edge labels |
| Reload after switching layout | Same layout comes back (localStorage) |
| Hover a node | Tooltip: type, name, day/value if any, page |
| Hover an edge | Tooltip sentence, e.g. “X is measured using Y” |
| Click a node | Inspector opens. The view zooms to that concept and its neighbors highlight; everything else dims. |
| Search icon (magnifying glass) | Type a name. Dropdown lists matching concepts and relationships. Click or Enter jumps to it. |
| Click an edge | Inspector: relationship sentence, required/condition if present |
| **Explain this in plain English** on a node | AI summary + jargon list. Second click is instant (cached). |
| **Explain this connection** | Same for the edge. Uses both endpoints. |
| Connected-concept “Explain this connection” | Switches the inspector to that edge |
| **Text view** | Lists every concept and relationship; clicking still opens the inspector |
| Zoom in / out / fit | Graph resizes; this is not an edit |
| Fuzzy / dashed border | Only if extraction notes say “approximate match” (NCT04082572 has these) |
| Color legend | Matches node types in the graph |

## 5. History and URLs

| Check | What you should see |
| --- | --- |
| History list | Newest first. Current file marked “Currently open”. |
| Click an analysis | Overview opens that file. URL is `#/analysis/{id}`. |
| Reload that URL | Same analysis comes back |
| Paste a fake id, e.g. `#/analysis/gone` | “This analysis no longer exists” |
| Analyses with scenarios | “N scenarios” under the row. Expand it. Click one → Simulate opens, URL is `#/analysis/{id}/scenario/{scenarioId}`. |
| Refresh | Reloads History |

## 6. Simulate

Open NCT03679767 → **Simulate**.

### 6a. Empty / draft state

| Check | What you should see |
| --- | --- |
| Banner | “Scenario based on NCT03679767.pdf. Changes never affect the original analysis.” |
| Side panel, nothing selected | “What the checks look at” (schedule + eligibility) |
| **Save edits** | Disabled |
| Pan / zoom / Web↔Flow | Save stays disabled |
| Click Simulate with no analysis open | “Open an analysis to simulate changes” |

### 6b. Editing

Click a node (easiest in **Flow** layout, or hover until you find it).

| Check | What you should see |
| --- | --- |
| Visit (Screening) | Study day, window before, window after, all with **Affects checks** + a one-line help sentence |
| Endpoint (ORR) | **Required day** with **Affects checks** |
| Eligibility (ALT / Age) | **Value** with **Affects checks** |
| Procedure / objective | Only label + description (checks ignore these) |
| Edge | Required / condition / arms / populations, plus a note that checks don’t read them yet |
| Change a number | Field shows **Original: …**. Pending changes (1) as a sentence. Save enables. Edited node gets a double/orange border. |
| Change the same field again | Still one pending line; `before` stays the original |
| Change it back to the original | Pending line disappears; Save disables |
| Undo on a pending line | That edit only is reverted |
| Discard all | Everything cleared |
| Invalid window (type `-3` in Window before) | Error “0 or more”; **no** pending edit |
| **Explain this in plain English** in the editor | Same AI box as Graph Explorer |

### 6c. Recipe that does create a finding

This is the one that proves Analyze works. Do **not** only change Screening’s window or ALT — those correctly change nothing on this file.

1. Click **Overall Response Rate (ORR)**.
2. Set **Required day** to `10`.
3. **Save edits** → name it `Manual: ORR day 10` → **Save scenario**.
4. Editor locks. Fields disable. **Analyze scenario** appears.
5. Click **Analyze scenario**.

Expect:

- Side panel: **Analyzed: 1 new finding**
- Page scrolls to results
- Banner **1 new finding**
- **New:** “No linked assessment scheduled for Overall Response Rate… Day 10 vs Day −28”
- Why line names your edit
- **In plain terms:** the schedule check explanation
- Graph highlights the affected concepts
- Overview / Graph Explorer on the **same file still have 0 findings** (parent never changes)

Then:

6. **Duplicate**
7. Click **Screening**, set **Window after** to `50`
8. Save as `Manual: ORR day 10 + window 50` → Analyze

Expect **No findings changed** — Screening now covers day 10 (`−28` to `22`).

### 6d. Recipe that correctly changes nothing

Reopen **History → NCT03679767 → Scenario 1** (window 27 → 50, no required day).

Expect:

- **No findings changed**
- **Why nothing changed:** Screening’s window doesn’t matter until a linked endpoint has a required day
- Side panel: **Analyzed: No findings changed** + “See what changed and why”

Rename a label and analyze: why-line should say the **label is not used by the checks**.

### 6e. Eligibility (optional)

On NCT03679767, ALT appears once, so changing `2.5` → `5` should say **this is the only criterion about alt max**.

To see a **conflict resolve**, you’d need a file with the same `field` twice (the injected fixture does: age 18 vs 21). You can’t easily do that from the UI without two eligibility nodes sharing a field. Skip unless you care; backend tests already cover it.

### 6f. Navigation around scenarios

| Check | What you should see |
| --- | --- |
| Saved-scenarios dropdown | Your new names, edit counts, “analyzed” |
| **New** | Fresh draft, empty pending list |
| **Duplicate** | Pending changes copied; Save enabled; URL drops the scenario id |
| History “N scenarios” | Includes the ones you just saved |
| Reload `#/analysis/{id}/scenario/{id}` | Same scenario, results still there |
| Leave Simulate for Overview | Original analysis unchanged |
| **Explain the effects in plain English** | AI paragraph + terms. Retry if Gemini 503s. Second click is cached. |

## 7. Cross-cutting

| Check | What you should see |
| --- | --- |
| Sidebar **Local workspace** / API host | Matches `http://127.0.0.1:8000` |
| Stop the backend, open History | “Could not load history”, sidebar **Backend unreachable** |
| Restart backend, Refresh | History returns |
| Narrow the window (~390px) | Nav collapses; graph Text view; inspector becomes a drawer |
| Escape with inspector open | Closes it |
| Upload another PDF | History now has two; switching between them keeps graphs/findings separate |

## 8. Things that are not bugs

If you hit these, the feature is working as designed:

- **Changing a visit window or eligibility value and getting 0 findings.** The checks only fire when an endpoint has a required day, or when the same eligibility `field` appears twice with different values. Extraction often leaves required days empty.
- **Editing edge `required` / condition doesn’t change findings.** The UI says so. Rules don’t read those fields yet.
- **You cannot add or delete nodes/edges.** Metadata only.
- **Findings update only after Save → Analyze**, not while you type.
- **Gemini “high demand”.** Retry. Analyze itself never calls Gemini.
- **Web layout looks random each remount.** That’s the cose layout. Metadata edits should **not** reshuffle it.

## Fast path (10 minutes)

1. `pytest` + `npm.cmd test` both green.
2. Open NCT03679767 from History. Graph Web/Flow, hover, click, explain one node.
3. Simulate → ORR **Required day = 10** → Save → Analyze → see **1 new finding** and the page scroll.
4. Duplicate → Screening **Window after = 50** → Analyze → **0 findings**.
5. History → expand scenarios → reopen the first one.
6. Overview still shows **0 findings** on the original file.

If those six hold, every major path is in place.
