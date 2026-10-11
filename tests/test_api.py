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


@pytest.mark.parametrize("origin, allowed", [
    ("http://127.0.0.1:5173", True), ("http://localhost:5173", True),
    ("https://evil.example", False)])
def test_cors_allows_only_frontend_origins(client, origin, allowed):
    response = client[0].get("/history", headers={"Origin": origin})
    assert (response.headers.get("access-control-allow-origin") == origin) is allowed


@pytest.mark.parametrize("name", ["baseline", "injected"])
def test_analyze_and_exact_retrieval(client, name):
    api, db_path = client
    response = upload(api, name)
    assert response.status_code == 200
    result = AnalysisResponse.model_validate(response.json())
    assert UUID(result.analysis_id).version == 4
    assert result.filename == "protocol.pdf"
    assert result.created_at is not None and result.created_at.tzinfo is not None
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


def test_history_order(client):
    api, db_path = client
    first = upload(api, filename="first.pdf").json()
    second = upload(api, "injected", "second.pdf").json()
    history = HistoryResponse.model_validate(api.get("/history").json())
    assert [item.analysis_id for item in history.analyses] == [second["analysis_id"], first["analysis_id"]]
    assert [item.filename for item in history.analyses] == ["second.pdf", "first.pdf"]
    assert [item.scenario_count for item in history.analyses] == [0, 0]


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
    assert api.post("/analyze").status_code == 422
    assert api.post("/simulate", json={}).status_code in (404, 405)


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


EXPLANATION = {"summary": "The study checks tumor size on day 42.",
               "terms": [{"term": "tumor response", "meaning": "Whether a tumor shrank."}]}


def use_explainer(fn):
    main.app.dependency_overrides[main.get_explainer] = lambda: fn


def test_explanation_is_generated_once_and_cached(client):
    api, _ = client
    analysis_id = upload(api).json()["analysis_id"]
    seen = []

    def explainer(prompt):
        seen.append(prompt)
        return EXPLANATION
    use_explainer(explainer)
    url = f"/graph/{analysis_id}/nodes/endpoint_response/explain"
    first = api.post(url)
    assert first.status_code == 200
    assert first.json() == {"item_id": "endpoint_response", **EXPLANATION}
    assert api.post(url).json() == first.json()
    assert len(seen) == 1
    assert "Explain this endpoint" in seen[0]
    assert "Tumor response will be assessed" in seen[0]


def test_relationship_explanation_uses_both_concepts_and_its_own_cache(client):
    api, _ = client
    analysis_id = upload(api).json()["analysis_id"]
    seen = []

    def explainer(prompt):
        seen.append(prompt)
        return EXPLANATION
    use_explainer(explainer)
    edge_id = "endpoint_response__MEASURED_BY__ct_scan"
    url = f"/graph/{analysis_id}/edges/{edge_id}/explain"
    assert api.post(url).json() == {"item_id": edge_id, **EXPLANATION}
    assert api.post(url).status_code == 200
    assert len(seen) == 1
    assert "measured using the procedure" in seen[0]
    assert "Tumor response will be assessed" in seen[0]
    assert "CT imaging" in seen[0]
    api.post(f"/graph/{analysis_id}/nodes/ct_scan/explain")
    assert len(seen) == 2
    assert api.post(f"/graph/{analysis_id}/edges/missing/explain").status_code == 404


def test_explanation_errors(client):
    api, _ = client
    analysis_id = upload(api).json()["analysis_id"]
    use_explainer(lambda prompt: EXPLANATION)
    assert api.post("/graph/unknown/nodes/x/explain").status_code == 404
    assert api.post(f"/graph/{analysis_id}/nodes/missing/explain").status_code == 404

    def broken(prompt):
        raise RuntimeError("model overloaded")
    use_explainer(broken)
    response = api.post(f"/graph/{analysis_id}/nodes/ct_scan/explain")
    assert response.status_code == 502
    use_explainer(lambda prompt: {"summary": "", "terms": []})
    assert api.post(f"/graph/{analysis_id}/nodes/ct_scan/explain").status_code == 502


def test_explain_validates_model_output():
    from backend.explainer import explain

    class FakeClient:
        def generate(self, prompt):
            return json.dumps(EXPLANATION)
    assert explain("prompt", FakeClient()).terms[0].term == "tumor response"


def test_old_explanation_cache_is_rebuilt(tmp_path):
    db_path = tmp_path / "old.sqlite3"
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE explanations (analysis_id TEXT, node_id TEXT, "
                   "explanation_json TEXT)")
    assert storage.fetch_explanation("a", "b", db_path) is None


def test_explanation_requires_api_key(client, monkeypatch):
    api, _ = client
    analysis_id = upload(api).json()["analysis_id"]
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    response = api.post(f"/graph/{analysis_id}/nodes/ct_scan/explain")
    assert response.status_code == 503


MOVE_VISIT = {"entity": "node", "target_id": "visit_baseline", "field": "day",
              "before": 0, "after": 42}


def create_scenario(api, analysis_id, edits=(MOVE_VISIT,), name="Later visit"):
    return api.post(f"/graph/{analysis_id}/scenarios", json={"name": name, "edits": list(edits)})


def test_scenario_lifecycle_leaves_parent_unchanged(client):
    api, db_path = client
    parent = upload(api, "injected").json()
    analysis_id = parent["analysis_id"]
    before = storage.fetch_analysis(analysis_id, db_path)

    created = create_scenario(api, analysis_id)
    assert created.status_code == 201
    scenario = created.json()
    assert scenario["status"] == "saved"
    assert scenario["edits"] == [MOVE_VISIT]
    assert scenario["findings"] is None and scenario["graph"] is None
    assert UUID(scenario["scenario_id"]).version == 4

    listed = api.get(f"/graph/{analysis_id}/scenarios").json()["scenarios"]
    assert [(item["name"], item["edit_count"], item["status"]) for item in listed] == [
        ("Later visit", 1, "saved")]
    assert api.get("/history").json()["analyses"][0]["scenario_count"] == 1

    analyzed = api.post(f"/scenarios/{scenario['scenario_id']}/analyze")
    assert analyzed.status_code == 200
    result = analyzed.json()
    assert result["status"] == "analyzed"
    assert [item["check_id"] for item in result["resolved_issues"]] == ["missing_assessment"]
    assert [item["check_id"] for item in result["remaining_issues"]] == ["eligibility_conflict"]
    assert result["new_issues"] == []
    assert "visit_baseline" in result["affected_nodes"]
    visit = next(node for node in result["graph"]["nodes"] if node["id"] == "visit_baseline")
    assert visit["day"] == 42
    assert api.post(f"/scenarios/{scenario['scenario_id']}/analyze").json() == result
    assert api.get(f"/scenarios/{scenario['scenario_id']}").json() == result
    assert api.get(f"/graph/{analysis_id}/scenarios").json()["scenarios"][0]["status"] == "analyzed"

    assert storage.fetch_analysis(analysis_id, db_path) == before
    assert api.get(f"/graph/{analysis_id}").json() == parent


def test_scenarios_are_scoped_to_their_analysis(client):
    api, _ = client
    first = upload(api, "injected").json()["analysis_id"]
    second = upload(api, "injected").json()["analysis_id"]
    create_scenario(api, first, name="one")
    create_scenario(api, first, name="two")
    assert [item["name"] for item in api.get(f"/graph/{first}/scenarios").json()["scenarios"]] == [
        "two", "one"]
    assert api.get(f"/graph/{second}/scenarios").json() == {"scenarios": []}


def test_scenario_rejects_stale_and_invalid_edits(client):
    api, _ = client
    analysis_id = upload(api, "injected").json()["analysis_id"]
    stale = create_scenario(api, analysis_id, [{**MOVE_VISIT, "before": 7}])
    assert stale.status_code == 409
    assert "visit_baseline" in stale.json()["detail"]
    assert create_scenario(api, analysis_id, [{**MOVE_VISIT, "target_id": "ghost"}]).status_code == 422
    assert create_scenario(api, analysis_id, [{**MOVE_VISIT, "after": "soon"}]).status_code == 422
    assert create_scenario(api, analysis_id, []).status_code == 422
    assert create_scenario(api, "unknown").status_code == 404
    assert api.get(f"/graph/{analysis_id}/scenarios").json() == {"scenarios": []}
    assert api.get("/scenarios/unknown").status_code == 404
    assert api.post("/scenarios/unknown/analyze").status_code == 404
    assert api.get("/graph/unknown/scenarios").status_code == 404


def test_scenario_explanation_is_grounded_and_cached(client):
    api, _ = client
    analysis_id = upload(api, "injected").json()["analysis_id"]
    scenario_id = create_scenario(api, analysis_id).json()["scenario_id"]
    seen = []

    def explainer(prompt):
        seen.append(prompt)
        return EXPLANATION
    use_explainer(explainer)
    url = f"/scenarios/{scenario_id}/explain"
    assert api.post(url).status_code == 409
    api.post(f"/scenarios/{scenario_id}/analyze")
    assert api.post(url).json() == {"item_id": scenario_id, **EXPLANATION}
    assert api.post(url).status_code == 200
    assert len(seen) == 1
    prompt = seen[0]
    assert '- visit "Baseline visit": day changed from 0 to 42' in prompt
    assert "Findings resolved by the edits:\n- " in prompt and "missing_assessment" in prompt
    assert "Tumor response will be assessed" in prompt
    assert api.post("/scenarios/unknown/explain").status_code == 404
