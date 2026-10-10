from pathlib import Path
import sqlite3
from uuid import UUID

from fastapi.testclient import TestClient
import pytest

from backend import main, storage
from backend.contracts import AnalysisResponse, GraphPayload, HistoryResponse
from backend.graph_engine import build_graph, graph_json
from backend.rules import validate

ROOT = Path(__file__).resolve().parents[1]


def payload(name):
    return GraphPayload.model_validate_json((ROOT / "data" / f"{name}.json").read_text())


@pytest.fixture
def client(tmp_path):
    db_path = tmp_path / "analyses.sqlite3"
    main.app.dependency_overrides[storage.get_database_path] = lambda: db_path
    with TestClient(main.app) as test_client:
        yield test_client, db_path
    main.app.dependency_overrides.clear()


def upload(client, name="baseline", filename="protocol.pdf"):
    def extractor(pdf_bytes):
        assert pdf_bytes.startswith(b"%PDF-")
        return payload(name)
    main.app.dependency_overrides[main.get_extractor] = lambda: extractor
    return client.post("/analyze", files={"file": (filename, b"%PDF-1.7\n", "application/pdf")})


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
    assert stored["extracted"] == payload(name)
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


def test_extraction_unavailable(client):
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
    analysis_id = storage.save_analysis("O'Brien.pdf", payload("baseline"), graph_json(graph), validate(graph))
    assert storage.fetch_analysis(analysis_id)["filename"] == "O'Brien.pdf"
    assert storage.list_history(second) == []
    assert storage.fetch_analysis(analysis_id, second) is None
