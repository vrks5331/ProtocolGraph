import json
from pathlib import Path
import sqlite3
from uuid import UUID

from fastapi.testclient import TestClient
import pytest

from backend import main, storage
from backend.contracts import AnalysisResponse, ExtractionIssue, GraphPayload, HistoryResponse
from backend.graph_engine import build_graph, graph_json
from backend.ingestion import ExtractionError, ExtractionResult
from backend.rules import validate

ROOT = Path(__file__).resolve().parents[1]
PDF_BYTES = b"%PDF-1.7\n"
ISSUE = ExtractionIssue(rule="source_grounding", action="fuzzy_match",
                        item_id="ct_scan", message="likely a table")


def payload(name):
    return GraphPayload.model_validate_json((ROOT / "data" / f"{name}.json").read_text())


def raw_json(name):
    return (ROOT / "data" / f"{name}.json").read_text()


def extraction(name, issues=()):
    return ExtractionResult(graph=payload(name), raw_json=raw_json(name), issues=list(issues))


@pytest.fixture
def client(tmp_path):
    db_path = tmp_path / "analyses.sqlite3"
    main.app.dependency_overrides[storage.get_database_path] = lambda: db_path
    with TestClient(main.app) as test_client:
        yield test_client, db_path
    main.app.dependency_overrides.clear()


def upload(client, name="baseline", filename="protocol.pdf", issues=()):
    def extractor(pdf_bytes):
        assert pdf_bytes == PDF_BYTES
        return extraction(name, issues)
    main.app.dependency_overrides[main.get_extractor] = lambda: extractor
    return client.post("/analyze", files={"file": (filename, PDF_BYTES, "application/pdf")})


def test_creation_empty_history_and_docs(client):
    api, db_path = client
    assert api.get("/history").json() == {"analyses": []}
    assert db_path.is_file()
    assert api.get("/docs").status_code == 200
    assert api.get("/openapi.json").status_code == 200


@pytest.mark.parametrize("name", ["baseline", "injected"])
def test_analyze_and_exact_retrieval(client, name):
    api, db_path = client
    response = upload(api, name)
    assert response.status_code == 200
    result = AnalysisResponse.model_validate(response.json())
    assert UUID(result.analysis_id).version == 4
    expected = GraphPayload.model_validate(graph_json(build_graph(payload(name))))
    assert result.graph == expected
    assert {item.check_id for item in result.findings} == (
        set() if name == "baseline" else {"eligibility_conflict", "missing_assessment"}
    )
    assert api.get(f"/graph/{result.analysis_id}").json() == response.json()
    stored = storage.fetch_analysis(result.analysis_id, db_path)
    assert stored["extracted"] == json.loads(raw_json(name))
    assert stored["graph"] == result.graph
    assert stored["findings"] == result.findings
    assert stored["created_at"].tzinfo is not None
    with sqlite3.connect(db_path) as db:
        assert db.execute("SELECT COUNT(*) FROM analyses").fetchone()[0] == 1


def test_history_order_and_simulation_immutability(client):
    api, db_path = client
    first = upload(api, filename="first.pdf").json()
    second = upload(api, "injected", "second.pdf").json()
    history = HistoryResponse.model_validate(api.get("/history").json())
    assert [item.analysis_id for item in history.analyses] == [second["analysis_id"], first["analysis_id"]]
    assert [item.filename for item in history.analyses] == ["second.pdf", "first.pdf"]
    before = storage.fetch_analysis(first["analysis_id"], db_path)
    response = api.post("/simulate", json={"graph": first["graph"],
                        "node_id": "endpoint_response", "changes": {"required_day": 70}})
    assert response.status_code == 200
    assert response.json()["new_issues"][0]["check_id"] == "missing_assessment"
    assert storage.fetch_analysis(first["analysis_id"], db_path) == before
    assert api.get(f"/graph/{first['analysis_id']}").json() == first


def test_unknown_id(client):
    assert client[0].get("/graph/unknown").status_code == 404
    assert storage.fetch_analysis("' OR 1=1 --", client[1]) is None


@pytest.mark.parametrize("content", [b"", b"not a PDF"])
def test_invalid_upload(client, content):
    assert client[0].post("/analyze", files={"file": ("test.pdf", content, "application/pdf")}).status_code == 400


def test_oversized_upload(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_PDF_BYTES", 10)
    assert client[0].post("/analyze", files={"file": ("test.pdf", b"%PDF-" + b"x" * 10)}).status_code == 413


def test_extraction_unavailable(client, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    response = client[0].post("/analyze", files={"file": ("test.pdf", b"%PDF-1.7")})
    assert response.status_code == 503
    assert "extraction" in response.json()["detail"]
    assert client[0].get("/history").json() == {"analyses": []}


def test_existing_routes_and_validation(client):
    api = client[0]
    response = api.post("/validate", json=payload("injected").model_dump(mode="json", exclude_none=True))
    assert response.status_code == 200
    assert response.json()["issues"] == validate(build_graph(payload("injected")))
    assert api.post("/validate", json={"nodes": [{"id": "x", "type": "bad"}]}).status_code == 422
    request = {"graph": payload("baseline").model_dump(mode="json", exclude_none=True),
               "node_id": "absent", "changes": {"day": 1}}
    assert api.post("/simulate", json=request).status_code == 400
    request["changes"] = {"label": 1}
    assert api.post("/simulate", json=request).status_code == 422
    assert api.post("/analyze").status_code == 422


def test_storage_failure_is_sanitized(client, monkeypatch):
    def fail(*args, **kwargs):
        raise sqlite3.OperationalError("private/internal/path")
    monkeypatch.setattr(storage, "save_analysis", fail)
    response = upload(client[0])
    assert response.status_code == 503
    assert response.json() == {"detail": "Analysis storage is unavailable"}


def test_bad_extractor_is_not_saved(client):
    main.app.dependency_overrides[main.get_extractor] = lambda: lambda data: {"nodes": [{"type": "bad"}]}
    assert client[0].post("/analyze", files={"file": ("test.pdf", b"%PDF-1.7")}).status_code == 502
    assert client[0].get("/history").json() == {"analyses": []}


def test_separate_databases_and_environment(tmp_path, monkeypatch):
    first, second = tmp_path / "first.sqlite3", tmp_path / "second.sqlite3"
    monkeypatch.setenv("PROTOCOLGRAPH_DB_PATH", str(first))
    storage.initialize_db()
    graph = build_graph(payload("baseline"))
    analysis_id = storage.save_analysis("O'Brien.pdf", raw_json("baseline"), graph_json(graph), validate(graph))
    assert storage.fetch_analysis(analysis_id)["filename"] == "O'Brien.pdf"
    assert storage.list_history(second) == []
    assert storage.fetch_analysis(analysis_id, second) is None


def test_extraction_error_is_reported_and_not_saved(client):
    def extractor(pdf_bytes):
        raise ExtractionError("PDF contains no extractable text")
    main.app.dependency_overrides[main.get_extractor] = lambda: extractor
    response = client[0].post("/analyze", files={"file": ("scan.pdf", PDF_BYTES)})
    assert response.status_code == 422
    assert response.json() == {"detail": "PDF contains no extractable text"}
    assert client[0].get("/history").json() == {"analyses": []}


def test_extraction_issues_are_returned_and_stored(client):
    api, db_path = client
    response = upload(api, issues=[ISSUE])
    assert response.json()["extraction_issues"] == [ISSUE.model_dump()]
    analysis_id = response.json()["analysis_id"]
    assert api.get(f"/graph/{analysis_id}").json()["extraction_issues"] == [ISSUE.model_dump()]


def test_uploaded_pdf_is_stored_and_served(client):
    api, db_path = client
    analysis_id = upload(api, filename="trial.pdf").json()["analysis_id"]
    stored = storage.fetch_analysis(analysis_id, db_path)
    assert Path(stored["pdf_path"]).parent == db_path.parent / "pdfs"
    response = api.get(f"/graph/{analysis_id}/pdf")
    assert response.status_code == 200
    assert response.content == PDF_BYTES
    assert response.headers["content-type"] == "application/pdf"
    assert api.get("/graph/unknown/pdf").status_code == 404


def test_pdf_is_removed_when_insert_fails(tmp_path, monkeypatch):
    db_path = tmp_path / "analyses.sqlite3"
    storage.initialize_db(db_path)
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TRIGGER no_insert BEFORE INSERT ON analyses "
                   "BEGIN SELECT RAISE(ABORT, 'blocked'); END")
    graph = build_graph(payload("baseline"))
    with pytest.raises(sqlite3.DatabaseError):
        storage.save_analysis("x.pdf", raw_json("baseline"), graph_json(graph), [],
                              db_path=db_path, pdf_bytes=PDF_BYTES)
    assert list((tmp_path / "pdfs").iterdir()) == []


def test_existing_database_gains_issues_column(tmp_path):
    db_path = tmp_path / "old.sqlite3"
    with sqlite3.connect(db_path) as db:
        db.execute("""CREATE TABLE analyses (
            id TEXT PRIMARY KEY, filename TEXT NOT NULL, created_at TEXT NOT NULL,
            extracted_json TEXT NOT NULL, graph_json TEXT NOT NULL,
            findings_json TEXT NOT NULL, pdf_path TEXT)""")
        db.execute("INSERT INTO analyses VALUES ('old', 'old.pdf', '2026-01-01T00:00:00+00:00',"
                   " ?, ?, '[]', NULL)", (raw_json("baseline"), raw_json("baseline")))
    assert storage.fetch_analysis("old", db_path)["extraction_issues"] == []
