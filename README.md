# ProtocolGraph

ProtocolGraph converts a clinical trial protocol into a validated graph, reports
logical inconsistencies, and simulates schedule changes.

## Backend flow

```text
PDF upload -> pdf_reader -> Gemini (structured JSON)
           -> Pydantic validation (one retry with errors fed back)
           -> consistency checks (grounding, edge types, duplicate merging)
           -> graph engine -> rules -> SQLite -> FastAPI response
```

`backend/contracts.py` is the shared boundary between the backend modules and
the frontend. Change it only through team agreement.

| Module | Responsibility |
| --- | --- |
| `backend/ingestion/` | PDF text, Gemini extraction, validation, consistency checks |
| `backend/graph_engine.py` | `GraphPayload` to and from a NetworkX `DiGraph` |
| `backend/rules.py` | Protocol findings (eligibility conflicts, missing assessments) |
| `backend/simulator.py` | What-if schedule changes |
| `backend/storage.py` | SQLite persistence and stored PDFs |
| `backend/main.py` | FastAPI app |
| `frontend/` | React + TypeScript + Vite workspace (React Flow graph view) |

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /analyze` | Upload a PDF; returns `analysis_id`, `graph`, `findings`, `extraction_issues` |
| `GET /graph/{analysis_id}` | A stored analysis |
| `GET /graph/{analysis_id}/pdf` | The uploaded PDF, for showing source pages |
| `GET /history` | Stored analyses, newest first |
| `POST /validate` | Run the rules on a graph |
| `POST /simulate` | Apply schedule changes to one node and diff the findings |

`/analyze` returns 422 when a PDF cannot be extracted (for example, a scanned
PDF with no text) and 503 when `GEMINI_API_KEY` is not set. Extraction of a
long protocol can take over a minute, so clients need a generous timeout.

## Configuration

Create a `.env` file in the repository root:

```text
GEMINI_API_KEY=your-key
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | none (required for `/analyze`) | Gemini API key |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini model used for extraction |
| `FRONTEND_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Comma-separated origins allowed to call the API from a browser |
| `PROTOCOLGRAPH_DB_PATH` | `~/.protocolgraph/analyses.sqlite3` | SQLite file; uploaded PDFs are stored in a `pdfs/` folder beside it |

The backend uses the operating system's certificate store (via `truststore`),
so HTTPS works on networks that inspect TLS traffic.

## Run the backend

```powershell
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --reload
```

If `pip` fails with `CERTIFICATE_VERIFY_FAILED`, install with
`uv pip install --native-tls -r requirements.txt` instead.

## Run the frontend

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open http://127.0.0.1:5173. The frontend currently runs on the sample graphs in
`data/` and does not call the backend yet; see
[frontend/README.md](frontend/README.md). If `npm install` fails with a
certificate error or "Exit handler never called", set `NODE_USE_SYSTEM_CA=1`
first so Node uses the operating system's certificate store.

## Run tests

```powershell
python -m pytest
cd frontend
npm.cmd test
npm.cmd run format:check
```

Backend tests use a fake Gemini client and never call the network. GitHub
Actions runs the backend tests and the frontend format check, tests, and build
on every pull request and on pushes to `main`. Run `npm.cmd run format` in
`frontend/` before committing frontend changes.

## Branches

`main` is the default branch. Work on a feature branch and open a pull request
into `main`.
