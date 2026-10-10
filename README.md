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

## Run tests

```powershell
python -m pytest
```

Tests use a fake Gemini client and never call the network.

## Branches

`main` is the default branch. Work on a feature branch and open a pull request
into `main`.
