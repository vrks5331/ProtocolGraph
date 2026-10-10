# ProtocolGraph

ProtocolGraph converts a clinical protocol into a validated graph, reports
logical inconsistencies, and simulates schedule changes.

## Backend flow

```text
PDF bytes -> ingestion -> GraphPayload -> graph engine -> rules/simulator
                                      -> SQLite storage -> FastAPI
```

`backend/contracts.py` is the shared boundary between these modules. Change it
only through team agreement.

## Parallel ownership

- `feat/pdf-extraction` owns `backend/ingestion/**` and
  `tests/test_ingestion.py`. It also owns any extraction-only dependency added
  to `requirements.txt`.
- `feat/api-storage` owns `backend/main.py`, `backend/storage.py`, and
  `tests/test_api.py`.
- `backend/contracts.py`, `backend/graph_engine.py`, `backend/rules.py`, and
  `backend/simulator.py` are frozen during parallel work.
- Update this README only on the integration branch.

Combine both branches on `fix/backend-integration` before merging into
`master`.

## Run the current backend

```powershell
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --reload
```

## Run tests

```powershell
python -m pytest
```
